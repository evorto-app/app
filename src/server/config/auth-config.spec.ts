import { ConfigProvider, Option } from 'effect';
import { describe, expect, it } from 'vitest';

import { loadAuthConfigSync } from './auth-config';

describe('auth-config', () => {
  it('keeps optional audience as Option.none when missing or blank', () => {
    const missingAudienceProvider = ConfigProvider.fromMap(
      new Map([
        ['BASE_URL', 'https://app.example'],
        ['CLIENT_ID', 'client-id'],
        ['CLIENT_SECRET', 'client-secret'],
        ['ISSUER_BASE_URL', 'https://issuer.example'],
        ['SECRET', 'super-secret'],
      ]),
    );
    const blankAudienceProvider = ConfigProvider.fromMap(
      new Map([
        ['AUDIENCE', '   '],
        ['BASE_URL', 'https://app.example'],
        ['CLIENT_ID', 'client-id'],
        ['CLIENT_SECRET', 'client-secret'],
        ['ISSUER_BASE_URL', 'https://issuer.example'],
        ['SECRET', 'super-secret'],
      ]),
    );

    expect(loadAuthConfigSync(missingAudienceProvider).AUDIENCE).toEqual(
      Option.none(),
    );
    expect(loadAuthConfigSync(blankAudienceProvider).AUDIENCE).toEqual(
      Option.none(),
    );
  });

  it('trims and keeps optional audience as Option.some when provided', () => {
    const provider = ConfigProvider.fromMap(
      new Map([
        ['AUDIENCE', '  https://api.example  '],
        ['BASE_URL', 'https://app.example'],
        ['CLIENT_ID', 'client-id'],
        ['CLIENT_SECRET', 'client-secret'],
        ['ISSUER_BASE_URL', 'https://issuer.example'],
        ['SECRET', 'super-secret'],
      ]),
    );

    expect(loadAuthConfigSync(provider).AUDIENCE).toEqual(
      Option.some('https://api.example'),
    );
  });
});
