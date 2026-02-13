import { Schema } from 'effect';
import { uniq } from 'es-toolkit';

import { getTenant, getUser, userAttributes } from '../../db';
import {
  ALL_PERMISSIONS,
  type Permission,
} from '../../shared/permissions/permissions';
import { type Authentication } from '../../types/custom/authentication';
import { Tenant } from '../../types/custom/tenant';
import { type User } from '../../types/custom/user';

const normalizePermission = (permission: Permission): Permission[] => {
  if (permission === 'admin:manageTaxes') {
    return ['admin:manageTaxes', 'admin:tax'];
  }

  return [permission];
};

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;

const resolveHostHeader = (
  input: readonly string[] | string | undefined,
): string | undefined => {
  if (typeof input === 'string') {
    return input;
  }

  if (Array.isArray(input)) {
    return input[0];
  }

  return undefined;
};

export const resolveAuthenticationContext = (input: {
  appSessionCookie: string | undefined;
  isAuthenticated: boolean;
}): Authentication => ({
  cookie: input.appSessionCookie,
  isAuthenticated: input.isAuthenticated,
});

export const resolveTenantContext = async (input: {
  cookies: Record<string, unknown> | undefined;
  protocol: string;
  requestHost: readonly string[] | string | undefined;
  signedCookies: Record<string, unknown> | undefined;
}): Promise<{
  cause: {
    domain: string;
    tenantCookie: string;
  };
  tenant: Tenant | undefined;
}> => {
  const cause = { domain: '', tenantCookie: '' };
  const tenantCookie =
    asString(input.signedCookies?.['evorto-tenant']) ??
    asString(input.cookies?.['evorto-tenant']);
  let tenantRecord;

  if (tenantCookie) {
    tenantRecord = await getTenant.execute({ domain: tenantCookie });
    cause.tenantCookie = tenantCookie;
  }

  const host = resolveHostHeader(input.requestHost);
  if (!tenantCookie && host) {
    const hostUrl = new URL(`${input.protocol}://${host}`);
    const domain = hostUrl.hostname;
    tenantRecord = await getTenant.execute({ domain });
    cause.domain = domain;
  }

  return {
    cause,
    tenant: tenantRecord ? Schema.decodeSync(Tenant)(tenantRecord) : undefined,
  };
};

export const resolveUserContext = async (input: {
  isAuthenticated: boolean;
  oidcUser: unknown;
  tenantId: string;
}): Promise<undefined | User> => {
  if (!input.isAuthenticated) {
    return undefined;
  }

  const oidcUser = asRecord(input.oidcUser);
  const auth0Id = asString(oidcUser?.['sub']);
  if (!auth0Id) {
    return undefined;
  }

  const user = await getUser.execute({
    auth0Id,
    tenantId: input.tenantId,
  });
  if (!user) {
    return undefined;
  }

  const appMetadata = asRecord(oidcUser?.['evorto.app/app_metadata']);
  const permissions: Permission[] =
    appMetadata?.['globalAdmin'] === true
      ? [...ALL_PERMISSIONS, 'globalAdmin:manageTenants']
      : user.tenantAssignments
          .flatMap((assignment) => assignment.roles)
          .flatMap((role) => role.permissions);

  const roleIds = user.tenantAssignments
    .flatMap((assignment) => assignment.roles)
    .flatMap((role) => role.id);

  const attributeResponse = await userAttributes
    .execute({
      tenantId: input.tenantId,
      userId: user.id,
    })
    .then((response) => response[0]);

  const attributes = [
    ...(attributeResponse?.organizesSome
      ? (['events:organizesSome'] as const)
      : []),
  ];

  return {
    ...user,
    attributes,
    permissions: uniq(
      permissions.flatMap((permission) => normalizePermission(permission)),
    ),
    roleIds,
  };
};
