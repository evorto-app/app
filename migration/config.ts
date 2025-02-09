export const migrationConfig = {
  authIdMap: {
    'google-oauth2|110521442319435018423': 'auth0|6775a3a47369b902878fdc74',
  },
  disableSpecials: false,
};

export const transformAuthId = (authId: string) => {
  if (migrationConfig.disableSpecials) {
    return authId;
  }
  return migrationConfig.authIdMap[authId] ?? authId;
};
