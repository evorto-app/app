import { describe, expect, it } from '@effect/vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  primaryCheckoutProviderCredentialNames,
  providerEnvironmentFromPrimaryCheckout,
} from './primary-provider-credentials';

const withPrimaryEnvironment = (
  contents: string,
  run: (primaryCheckoutRoot: string) => void,
): void => {
  const primaryCheckoutRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'evorto primary provider env '),
  );
  try {
    fs.writeFileSync(path.join(primaryCheckoutRoot, '.env'), contents, {
      mode: 0o600,
    });
    run(primaryCheckoutRoot);
  } finally {
    fs.rmSync(primaryCheckoutRoot, { force: true, recursive: true });
  }
};

describe('primary checkout provider credentials', () => {
  it('loads only missing provider values and leaves worktree settings unchanged', () => {
    withPrimaryEnvironment(
      [
        'DATABASE_URL=postgresql://primary.example/unsafe',
        'E2E_LIVE_ESN_CARD_EXPIRED_IDENTIFIER=expired-card',
        'E2E_LIVE_ESN_CARD_IDENTIFIER=active-card',
        'PUBLIC_GOOGLE_MAPS_API_KEY=maps-key',
      ].join('\n'),
      (primaryCheckoutRoot) => {
        const result = providerEnvironmentFromPrimaryCheckout({
          environment: {
            DATABASE_URL: 'postgresql://localhost/worktree',
            E2E_LIVE_ESN_CARD_IDENTIFIER: 'explicit-active-card',
          },
          primaryCheckoutRoot,
        });

        expect(result.loadedNames).toEqual([
          'E2E_LIVE_ESN_CARD_EXPIRED_IDENTIFIER',
          'PUBLIC_GOOGLE_MAPS_API_KEY',
        ]);
        expect(result.environment).toMatchObject({
          DATABASE_URL: 'postgresql://localhost/worktree',
          E2E_LIVE_ESN_CARD_EXPIRED_IDENTIFIER: 'expired-card',
          E2E_LIVE_ESN_CARD_IDENTIFIER: 'explicit-active-card',
          PUBLIC_GOOGLE_MAPS_API_KEY: 'maps-key',
        });
      },
    );
  });

  it('does not read the primary file when every provider value is already set', () => {
    const result = providerEnvironmentFromPrimaryCheckout({
      environment: Object.fromEntries(
        primaryCheckoutProviderCredentialNames.map((name) => [name, name]),
      ),
      primaryCheckoutRoot: '/does/not/exist',
    });

    expect(result.loadedNames).toEqual([]);
  });

  it('leaves missing values visible when the primary checkout has no local env', () => {
    const primaryCheckoutRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'evorto empty primary env '),
    );
    try {
      const result = providerEnvironmentFromPrimaryCheckout({
        environment: { DATABASE_URL: 'postgresql://localhost/worktree' },
        primaryCheckoutRoot,
      });

      expect(result.loadedNames).toEqual([]);
      expect(result.environment).toEqual({
        DATABASE_URL: 'postgresql://localhost/worktree',
      });
    } finally {
      fs.rmSync(primaryCheckoutRoot, { force: true, recursive: true });
    }
  });
});
