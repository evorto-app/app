export const RPC_CONTEXT_HEADERS = {
  AUTH_DATA: 'x-evorto-auth-data',
  AUTHENTICATED: 'x-evorto-authenticated',
  PERMISSIONS: 'x-evorto-permissions',
  TENANT: 'x-evorto-tenant',
  USER: 'x-evorto-user',
  USER_ASSIGNED: 'x-evorto-user-assigned',
} as const;

export const encodeRpcContextHeaderJson = (value: unknown): string =>
  Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');

export const decodeRpcContextHeaderJson = (
  value: string | undefined,
): unknown => {
  if (value === undefined) {
    return null;
  }

  const json = Buffer.from(value, 'base64url').toString('utf8');
  return JSON.parse(json);
};
