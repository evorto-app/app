import consola from 'consola';
import { NextFunction, Request, Response } from 'express';

import {
  resolveAuthenticationContext,
  resolveTenantContext,
  resolveUserContext,
} from '../context/request-context-resolver';

export const addRequestContext = async (
  request: Request,
  response: Response,
  next: NextFunction,
) => {
  request.authentication = resolveAuthenticationContext({
    appSessionCookie: request.cookies['appSession'],
    isAuthenticated: request?.oidc?.isAuthenticated() ?? false,
  });

  const { cause, tenant } = await resolveTenantContext({
    cookies: request.cookies,
    protocol: request.protocol,
    requestHost: request.headers['x-forwarded-host'] || request.headers['host'],
    signedCookies: request.signedCookies,
  });

  if (!tenant) {
    consola.error('Tenant not found', cause);
    next(new Error('Tenant not found', { cause }));
    return;
  }

  request.tenant = tenant;

  const user = await resolveUserContext({
    isAuthenticated: request?.oidc?.isAuthenticated() ?? false,
    oidcUser: request.oidc?.user,
    tenantId: tenant.id,
  });

  if (user) {
    request.user = user;
  }

  next();
};
