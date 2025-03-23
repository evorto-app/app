import consola from 'consola';
import { Schema } from 'effect';
import { NextFunction, Request, Response } from 'express';

import { getTenant } from '../../db';
import { Tenant } from '../../types/custom/tenant';

export const addTenantContext = async (
  request: Request,
  response: Response,
  next: NextFunction,
) => {
  const cause = { domain: '', tenantCookie: '' };
  const tenantCookie =
    request.signedCookies?.['evorto-tenant'] ??
    request.cookies?.['evorto-tenant'];
  let tenant;
  if (tenantCookie) {
    tenant = await getTenant.execute({ domain: tenantCookie });
    cause.tenantCookie = tenantCookie;
  }
  const host = request.headers['x-forwarded-host'] || request.headers['host'];

  if (!tenantCookie && host && typeof host === 'string') {
    const hostUrl = new URL(`${request.protocol}://${host}`);
    const domain = hostUrl.hostname;
    tenant = await getTenant.execute({ domain });
    cause.domain = domain;
  }

  if (tenant) {
    request.tenant = Schema.decodeSync(Tenant)(tenant);
    next();
  } else {
    consola.error('Tenant not found', cause);
    next(new Error('Tenant not found', { cause }));
  }
};
