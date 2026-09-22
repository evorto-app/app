import { describe, expect, it, vi } from 'vitest';

import { requirePlatformAdministratorClaim } from '../../tests/support/auth0/platform-administrator-claim-fixture';

describe('platform administrator Auth0 claim fixture', () => {
  it.each([
    undefined,
    {},
    { platformAdministrator: false },
    { platformAdministrator: null },
    { platformAdministrator: 'true' },
    { platformAdministrator: 1 },
  ])('rejects an unconfigured administrator claim: %j', async (metadata) => {
    const client = {
      readAppMetadata: async () => metadata,
      updateAppMetadata: vi.fn(async () => {}),
    };

    await expect(requirePlatformAdministratorClaim(client)).rejects.toThrow(
      'must be preconfigured with app_metadata.platformAdministrator=true by an authorized owner',
    );
    expect(client.updateAppMetadata).not.toHaveBeenCalled();
  });

  it('allows concurrent runs without changing their shared administrator claim', async () => {
    const metadata = Object.freeze({
      existingSetting: 'kept',
      platformAdministrator: true,
    });
    const client = {
      readAppMetadata: vi.fn(async () => metadata),
      updateAppMetadata: vi.fn(async () => {}),
    };

    await expect(
      Promise.all([
        requirePlatformAdministratorClaim(client),
        requirePlatformAdministratorClaim(client),
      ]),
    ).resolves.toEqual([undefined, undefined]);

    expect(client.readAppMetadata).toHaveBeenCalledTimes(2);
    expect(client.updateAppMetadata).not.toHaveBeenCalled();
    expect(metadata).toEqual({
      existingSetting: 'kept',
      platformAdministrator: true,
    });
    await expect(
      requirePlatformAdministratorClaim(client),
    ).resolves.toBeUndefined();
    expect(client.updateAppMetadata).not.toHaveBeenCalled();
  });

  it('preserves provider read failures without attempting a metadata write', async () => {
    const readError = new Error('Could not read the configured test identity');
    const client = {
      readAppMetadata: vi
        .fn<() => Promise<Record<string, unknown>>>()
        .mockRejectedValue(readError),
      updateAppMetadata: vi.fn(async () => {}),
    };

    await expect(requirePlatformAdministratorClaim(client)).rejects.toBe(
      readError,
    );
    expect(client.updateAppMetadata).not.toHaveBeenCalled();
  });
});
