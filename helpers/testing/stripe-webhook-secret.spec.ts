import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import {
  resolveStripeWebhookSecret,
  type StripeWebhookSecretDockerRuntime,
} from './stripe-webhook-secret';

const runtimeWith = (
  overrides: Partial<StripeWebhookSecretDockerRuntime>,
): StripeWebhookSecretDockerRuntime => ({
  findRunningApplicationContainer: async () => undefined,
  readApplicationWebhookSecret: async () => undefined,
  wait: async () => undefined,
  ...overrides,
});

describe('resolveStripeWebhookSecret', () => {
  it('waits for the running Docker application secret instead of using the static fallback', async () => {
    const observedWaits: number[] = [];
    const dockerSecrets = [undefined, 'whsec_docker_current'];
    const secret = await resolveStripeWebhookSecret({
      dockerRuntime: runtimeWith({
        findRunningApplicationContainer: async () => 'abc123',
        readApplicationWebhookSecret: async () => dockerSecrets.shift(),
        wait: async (milliseconds) => {
          observedWaits.push(milliseconds);
        },
      }),
      environment: {
        COMPOSE_PROJECT_NAME: 'evorto-test',
        STRIPE_WEBHOOK_SECRET: 'whsec_static_stale',
      },
      pollIntervalsMs: [25],
    });

    expect(secret).toBe('whsec_docker_current');
    expect(observedWaits).toEqual([25]);
  });

  it('fails closed without exposing a static secret when the Docker secret never becomes ready', async () => {
    const staticSecret = 'whsec_never_include_in_error';
    let failure: unknown;

    try {
      await resolveStripeWebhookSecret({
        dockerRuntime: runtimeWith({
          findRunningApplicationContainer: async () => 'abc123',
        }),
        environment: {
          COMPOSE_PROJECT_NAME: 'evorto-test',
          STRIPE_WEBHOOK_SECRET: staticSecret,
        },
        pollIntervalsMs: [],
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(Error);
    expect(String(failure)).toContain(
      'running Docker application did not expose its Stripe webhook signing secret',
    );
    expect(String(failure)).not.toContain(staticSecret);
  });

  it('uses the static secret only when no Docker application is running', async () => {
    await expect(
      resolveStripeWebhookSecret({
        dockerRuntime: runtimeWith({}),
        environment: {
          COMPOSE_PROJECT_NAME: 'evorto-test',
          STRIPE_WEBHOOK_SECRET: 'whsec_static_host_runtime',
        },
      }),
    ).resolves.toBe('whsec_static_host_runtime');
  });

  it('fails explicitly when neither supported secret source is available', async () => {
    await expect(
      resolveStripeWebhookSecret({
        dockerRuntime: runtimeWith({}),
        environment: {},
      }),
    ).rejects.toThrow(
      'A running Docker application or STRIPE_WEBHOOK_SECRET is required',
    );
  });
});

describe('Stripe-backed Playwright source wiring', () => {
  const source = (relativePath: string) =>
    fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');

  it('uses the shared resolver and keeps provider-heavy files out of full parallelism', () => {
    const registrationWebhook = source(
      'tests/support/utils/registration-checkout-webhook.ts',
    );
    const replay = source('tests/specs/finance/stripe-webhook-replay.spec.ts');
    const manualApproval = source('tests/specs/events/manual-approval.spec.ts');

    expect(registrationWebhook).toContain('resolveStripeWebhookSecret');
    expect(registrationWebhook).not.toContain('readDockerWebhookSecret');
    expect(replay).toContain('resolveStripeWebhookSecret');
    expect(replay).not.toContain("process.env['STRIPE_WEBHOOK_SECRET']");
    expect(replay).toContain("test.describe.configure({ mode: 'default' });");
    expect(manualApproval).toContain(
      "test.describe.configure({ mode: 'default' });",
    );
  });
});
