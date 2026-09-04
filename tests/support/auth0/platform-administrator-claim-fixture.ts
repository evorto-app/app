const platformAdministratorClaim = 'platformAdministrator';

export interface PlatformAdministratorClaimFixtureClient {
  readAppMetadata: () => Promise<Record<string, unknown> | undefined>;
  updateAppMetadata: (metadata: Record<string, unknown>) => Promise<void>;
}

export const preparePlatformAdministratorClaim = async (
  client: PlatformAdministratorClaimFixtureClient,
): Promise<() => Promise<void>> => {
  const appMetadata = (await client.readAppMetadata()) ?? {};
  const claimWasPresent = Object.hasOwn(
    appMetadata,
    platformAdministratorClaim,
  );
  const previousClaim = appMetadata[platformAdministratorClaim];

  if (previousClaim === true) {
    return async () => {};
  }

  let restored = false;
  const restore = async () => {
    if (restored) return;

    await client.updateAppMetadata({
      [platformAdministratorClaim]: claimWasPresent ? previousClaim : null,
    });
    restored = true;
  };

  try {
    await client.updateAppMetadata({
      [platformAdministratorClaim]: true,
    });
  } catch (enableError) {
    try {
      await restore();
    } catch (restoreError) {
      throw new AggregateError(
        [enableError, restoreError],
        'Failed to enable and restore the platform administrator claim',
        { cause: restoreError },
      );
    }

    throw enableError;
  }

  return restore;
};
