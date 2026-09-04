import { describe, expect, it, vi } from 'vitest';

import { preparePlatformAdministratorClaim } from '../../tests/support/auth0/platform-administrator-claim-fixture';

describe('platform administrator Auth0 claim fixture', () => {
  it('sets the production metadata field and removes it after the test', async () => {
    const updateAppMetadata = vi.fn(async () => {});
    const restore = await preparePlatformAdministratorClaim({
      readAppMetadata: async () => ({ existingSetting: 'kept' }),
      updateAppMetadata,
    });

    expect(updateAppMetadata).toHaveBeenNthCalledWith(1, {
      platformAdministrator: true,
    });

    await restore();
    await restore();

    expect(updateAppMetadata).toHaveBeenNthCalledWith(2, {
      platformAdministrator: null,
    });
    expect(updateAppMetadata).toHaveBeenCalledTimes(2);
  });

  it('restores an existing non-authoritative value exactly', async () => {
    const updateAppMetadata = vi.fn(async () => {});
    const restore = await preparePlatformAdministratorClaim({
      readAppMetadata: async () => ({ platformAdministrator: false }),
      updateAppMetadata,
    });

    await restore();

    expect(updateAppMetadata).toHaveBeenNthCalledWith(1, {
      platformAdministrator: true,
    });
    expect(updateAppMetadata).toHaveBeenNthCalledWith(2, {
      platformAdministrator: false,
    });
  });

  it('does not mutate an identity that already has the production claim', async () => {
    const updateAppMetadata = vi.fn(async () => {});
    const restore = await preparePlatformAdministratorClaim({
      readAppMetadata: async () => ({ platformAdministrator: true }),
      updateAppMetadata,
    });

    await restore();

    expect(updateAppMetadata).not.toHaveBeenCalled();
  });

  it('restores a claim when enabling changes the remote state and then rejects', async () => {
    const enableError = new Error('The update response was lost');
    let appMetadata: Record<string, unknown> = {
      existingSetting: 'kept',
      platformAdministrator: false,
    };
    const updateAppMetadata = vi.fn(
      async (metadata: Record<string, unknown>) => {
        appMetadata = { ...appMetadata, ...metadata };
        if (metadata['platformAdministrator'] === true) throw enableError;
      },
    );

    await expect(
      preparePlatformAdministratorClaim({
        readAppMetadata: async () => appMetadata,
        updateAppMetadata,
      }),
    ).rejects.toBe(enableError);

    expect(appMetadata).toEqual({
      existingSetting: 'kept',
      platformAdministrator: false,
    });
    expect(updateAppMetadata).toHaveBeenCalledTimes(2);
    expect(updateAppMetadata).toHaveBeenNthCalledWith(2, {
      platformAdministrator: false,
    });
  });

  it('preserves both errors when enabling and rollback fail', async () => {
    const enableError = new Error('Could not confirm the claim update');
    const restoreError = new Error('Could not restore the claim');
    const updateAppMetadata = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(enableError)
      .mockRejectedValueOnce(restoreError);
    const preparation = preparePlatformAdministratorClaim({
      readAppMetadata: async () => ({}),
      updateAppMetadata,
    });

    await expect(preparation).rejects.toBeInstanceOf(AggregateError);
    await expect(preparation).rejects.toMatchObject({
      cause: restoreError,
      errors: [enableError, restoreError],
    });
    expect(updateAppMetadata).toHaveBeenNthCalledWith(2, {
      platformAdministrator: null,
    });
  });
});
