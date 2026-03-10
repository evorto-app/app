import { ConfigProvider, Option } from 'effect';
import { describe, expect, it } from 'vitest';

import { loadServerConfigSync } from './server-config';

describe('server-config', () => {
  it('only reads PUBLIC_GOOGLE_MAPS_API_KEY', () => {
    const legacyProvider = ConfigProvider.fromMap(
      new Map([['GOOGLE_MAPS_API_KEY', 'legacy-key']]),
    );
    const canonicalProvider = ConfigProvider.fromMap(
      new Map([['PUBLIC_GOOGLE_MAPS_API_KEY', 'canonical-key']]),
    );

    expect(
      loadServerConfigSync(legacyProvider).PUBLIC_GOOGLE_MAPS_API_KEY,
    ).toEqual(Option.none());
    expect(
      loadServerConfigSync(canonicalProvider).PUBLIC_GOOGLE_MAPS_API_KEY,
    ).toEqual(Option.some('canonical-key'));
  });
});
