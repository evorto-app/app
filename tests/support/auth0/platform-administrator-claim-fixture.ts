const platformAdministratorClaim = 'platformAdministrator';

export interface PlatformAdministratorClaimFixtureClient {
  readAppMetadata: () => Promise<Record<string, unknown> | undefined>;
}

export const requirePlatformAdministratorClaim = async (
  client: PlatformAdministratorClaimFixtureClient,
): Promise<void> => {
  const appMetadata = await client.readAppMetadata();

  if (appMetadata?.[platformAdministratorClaim] !== true) {
    throw new Error(
      'The dedicated Auth0 administrator test account must be preconfigured with app_metadata.platformAdministrator=true by an authorized owner. Authenticated tests never grant or revoke administrator access.',
    );
  }
};
