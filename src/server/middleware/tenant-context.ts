import consola from 'consola';
import { NextFunction, Request, Response } from 'express';

import { resolveTenantContext } from '../context/request-context-resolver';

export const addTenantContext = async (
  request: Request,
  response: Response,
  next: NextFunction,
) => {
  const { cause, tenant } = await resolveTenantContext({
    cookies: request.cookies,
    protocol: request.protocol,
    requestHost: request.headers['x-forwarded-host'] || request.headers['host'],
    signedCookies: request.signedCookies,
  });
  if (tenant) {
    request.tenant = tenant;
    next();
  } else {
    consola.error('Tenant not found', cause);
    next(new Error('Tenant not found', { cause }));
  }
};
