import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const defaultPollIntervalsMs = [
  250, 500, 1_000, 2_000, 4_000, 4_000, 4_000, 4_000, 4_000,
] as const;

interface StripeWebhookSecretEnvironment {
  readonly COMPOSE_PROJECT_NAME?: string | undefined;
  readonly STRIPE_WEBHOOK_SECRET?: string | undefined;
}

export interface StripeWebhookSecretDockerRuntime {
  readonly findRunningApplicationContainer: (
    composeProject: string,
  ) => Promise<string | undefined>;
  readonly readApplicationWebhookSecret: (
    containerId: string,
  ) => Promise<string | undefined>;
  readonly wait: (milliseconds: number) => Promise<void>;
}

interface ResolveStripeWebhookSecretOptions {
  readonly dockerRuntime?: StripeWebhookSecretDockerRuntime | undefined;
  readonly environment?: StripeWebhookSecretEnvironment | undefined;
  readonly pollIntervalsMs?: readonly number[] | undefined;
}

const normalizedSecret = (value: string | undefined): string | undefined => {
  const secret = value?.trim();
  return secret ? secret : undefined;
};

const defaultDockerRuntime: StripeWebhookSecretDockerRuntime = {
  findRunningApplicationContainer: async (composeProject) => {
    const { stdout } = await execFileAsync('docker', [
      'ps',
      '--quiet',
      '--filter',
      `label=com.docker.compose.project=${composeProject}`,
      '--filter',
      'label=com.docker.compose.service=evorto',
    ]);
    const containerId = stdout.trim().split(/\s+/u)[0];
    return containerId && /^[a-f0-9]+$/u.test(containerId)
      ? containerId
      : undefined;
  },
  readApplicationWebhookSecret: async (containerId) => {
    try {
      const { stdout } = await execFileAsync('docker', [
        'exec',
        containerId,
        'cat',
        '/run/stripe-webhook/signing-secret',
      ]);
      return normalizedSecret(stdout);
    } catch {
      return;
    }
  },
  wait: (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
};

/**
 * Resolves the signing secret used by the running application without logging
 * or persisting it. A running Compose application is authoritative: wait for
 * its file-backed Stripe CLI secret instead of silently signing with a stale
 * static secret that the application will reject.
 */
export const resolveStripeWebhookSecret = async ({
  dockerRuntime = defaultDockerRuntime,
  environment = process.env,
  pollIntervalsMs = defaultPollIntervalsMs,
}: ResolveStripeWebhookSecretOptions = {}): Promise<string> => {
  const composeProject = environment.COMPOSE_PROJECT_NAME?.trim();
  if (composeProject) {
    const containerId =
      await dockerRuntime.findRunningApplicationContainer(composeProject);
    if (containerId) {
      for (const interval of [...pollIntervalsMs, undefined]) {
        const dockerSecret = normalizedSecret(
          await dockerRuntime.readApplicationWebhookSecret(containerId),
        );
        if (dockerSecret) {
          return dockerSecret;
        }
        if (interval !== undefined) {
          await dockerRuntime.wait(interval);
        }
      }
      throw new Error(
        'The running Docker application did not expose its Stripe webhook signing secret before the test timeout',
      );
    }
  }

  const staticSecret = normalizedSecret(environment.STRIPE_WEBHOOK_SECRET);
  if (staticSecret) {
    return staticSecret;
  }
  throw new Error(
    'A running Docker application or STRIPE_WEBHOOK_SECRET is required for signed webhook tests',
  );
};
