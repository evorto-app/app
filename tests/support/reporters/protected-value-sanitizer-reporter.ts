import type {
  FullResult,
  Reporter,
  TestError,
  TestResult,
} from '@playwright/test/reporter';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { stripVTControlCharacters } from 'node:util';

import { protectedEnvironmentVariables } from '../protected-values';

const protectedValueReplacement = '[protected value]';

const protectedValues = (): string[] =>
  [
    ...new Set(
      protectedEnvironmentVariables.flatMap((name) => {
        const value = process.env[name];
        if (!value) return [];
        const trimmed = value.trim();
        return trimmed && trimmed !== value ? [value, trimmed] : [value];
      }),
    ),
  ].sort((left, right) => right.length - left.length);

export const redactProtectedValues = (
  value: string,
  secrets: readonly string[],
): string =>
  secrets.reduce(
    (sanitized, secret) =>
      sanitized.split(secret).join(protectedValueReplacement),
    stripVTControlCharacters(value).replace(
      /^([ \t]*(?:-[ \t]*)?(?:cookie|set-cookie|authorization|proxy-authorization)[ \t]*:)[^\r\n]*/gimu,
      '$1 [protected header]',
    ),
  );

const sanitizeError = (
  error: TestError | undefined,
  secrets: readonly string[],
): void => {
  if (!error) return;
  for (const key of ['message', 'snippet', 'stack', 'value'] as const) {
    if (error[key]) {
      error[key] = redactProtectedValues(error[key], secrets);
    }
  }
  sanitizeError(error.cause, secrets);
};

const bufferContainsProtectedValue = (
  value: Buffer,
  secrets: readonly string[],
): boolean => {
  const text = value.toString('utf8');
  return (
    secrets.some((secret) => text.includes(secret)) ||
    redactProtectedValues(text, secrets) !== stripVTControlCharacters(text)
  );
};

const sanitizeAttachment = (
  attachment: TestResult['attachments'][number],
  secrets: readonly string[],
  recordFailure: () => void,
): boolean => {
  try {
    const isAutomaticErrorContext =
      attachment.name === 'error-context' ||
      (attachment.path !== undefined &&
        path.basename(attachment.path) === 'error-context.md');
    if (isAutomaticErrorContext) {
      if (attachment.path) {
        rmSync(attachment.path, { force: true });
      }
      return false;
    }

    attachment.name = redactProtectedValues(attachment.name, secrets);
    if (
      attachment.body &&
      bufferContainsProtectedValue(attachment.body, secrets)
    ) {
      if (attachment.contentType.startsWith('text/')) {
        attachment.body = Buffer.from(
          redactProtectedValues(attachment.body.toString('utf8'), secrets),
        );
      } else {
        return false;
      }
    }

    if (attachment.path) {
      if (
        secrets.some((secret) => attachment.path?.includes(secret) === true)
      ) {
        rmSync(attachment.path, { force: true });
        return false;
      }

      const body = readFileSync(attachment.path);
      if (bufferContainsProtectedValue(body, secrets)) {
        if (attachment.contentType.startsWith('text/')) {
          writeFileSync(
            attachment.path,
            redactProtectedValues(body.toString('utf8'), secrets),
          );
        } else {
          rmSync(attachment.path, { force: true });
          return false;
        }
      }
    }

    return true;
  } catch {
    if (attachment.path) {
      try {
        rmSync(attachment.path, { force: true });
      } catch {
        // The run still fails below. Never put the path or attachment name in
        // the failure text because either may itself contain a protected value.
      }
    }
    recordFailure();
    return false;
  }
};

class ProtectedValueSanitizerReporter implements Reporter {
  private attachmentSanitizationFailures = 0;
  private readonly pendingOutput = {
    stderr: Buffer.alloc(0),
    stdout: Buffer.alloc(0),
  };

  private writeOutput(
    stream: 'stderr' | 'stdout',
    chunk: string | Buffer,
  ): void {
    const pending = Buffer.concat([
      this.pendingOutput[stream],
      Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk),
    ]);
    const newline = pending.lastIndexOf(10);
    if (newline >= 0) {
      process[stream].write(
        redactProtectedValues(
          pending.subarray(0, newline + 1).toString('utf8'),
          protectedValues(),
        ),
      );
    }
    this.pendingOutput[stream] = pending.subarray(newline + 1);
  }

  private flushOutput(): void {
    for (const stream of ['stdout', 'stderr'] as const) {
      if (this.pendingOutput[stream].length === 0) continue;
      process[stream].write(
        redactProtectedValues(
          this.pendingOutput[stream].toString('utf8'),
          protectedValues(),
        ),
      );
      this.pendingOutput[stream] = Buffer.alloc(0);
    }
  }

  onError(error: TestError): void {
    sanitizeError(error, protectedValues());
  }

  onStdErr(chunk: string | Buffer): void {
    this.writeOutput('stderr', chunk);
  }

  onStdOut(chunk: string | Buffer): void {
    this.writeOutput('stdout', chunk);
  }

  onTestEnd(_test: unknown, result: TestResult): void {
    const secrets = protectedValues();
    for (const error of result.errors) sanitizeError(error, secrets);
    sanitizeError(result.error, secrets);
    for (const stream of ['stdout', 'stderr'] as const) {
      if (result[stream].length === 0) continue;
      const text = Buffer.concat(
        result[stream].map((chunk) =>
          Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk),
        ),
      ).toString('utf8');
      result[stream] = [redactProtectedValues(text, secrets)];
    }
    result.attachments.splice(
      0,
      result.attachments.length,
      ...result.attachments.filter((attachment) =>
        sanitizeAttachment(attachment, secrets, () => {
          this.attachmentSanitizationFailures += 1;
        }),
      ),
    );
  }

  async onEnd(): Promise<{ status?: FullResult['status'] } | undefined> {
    this.flushOutput();
    if (this.attachmentSanitizationFailures === 0) return undefined;

    process.stderr.write(
      `Protected-value attachment sanitization failed closed for ${this.attachmentSanitizationFailures} attachment(s).\n`,
    );
    return { status: 'failed' };
  }

  printsToStdio(): boolean {
    return true;
  }
}

export default ProtectedValueSanitizerReporter;
