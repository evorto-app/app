import type {
  FullResult,
  Reporter,
  TestError,
  TestResult,
} from '@playwright/test/reporter';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

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
    value,
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
): boolean => secrets.some((secret) => value.includes(Buffer.from(secret)));

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

  onError(error: TestError): void {
    sanitizeError(error, protectedValues());
  }

  onStdErr(chunk: string | Buffer): void {
    const secrets = protectedValues();
    process.stderr.write(
      Buffer.isBuffer(chunk)
        ? Buffer.from(redactProtectedValues(chunk.toString('utf8'), secrets))
        : redactProtectedValues(chunk, secrets),
    );
  }

  onStdOut(chunk: string | Buffer): void {
    const secrets = protectedValues();
    process.stdout.write(
      Buffer.isBuffer(chunk)
        ? Buffer.from(redactProtectedValues(chunk.toString('utf8'), secrets))
        : redactProtectedValues(chunk, secrets),
    );
  }

  onTestEnd(_test: unknown, result: TestResult): void {
    const secrets = protectedValues();
    for (const error of result.errors) sanitizeError(error, secrets);
    sanitizeError(result.error, secrets);
    result.stdout = result.stdout.map((value) =>
      Buffer.isBuffer(value)
        ? Buffer.from(redactProtectedValues(value.toString('utf8'), secrets))
        : redactProtectedValues(value, secrets),
    );
    result.stderr = result.stderr.map((value) =>
      Buffer.isBuffer(value)
        ? Buffer.from(redactProtectedValues(value.toString('utf8'), secrets))
        : redactProtectedValues(value, secrets),
    );
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

  onEnd(): { status?: FullResult['status'] } | undefined {
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
