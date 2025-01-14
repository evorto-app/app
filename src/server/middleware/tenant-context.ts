import { NextFunction, Request, Response } from 'express';

import { getTenant } from '../../db';

export const addTenantContext = async (
  request: Request,
  response: Response,
  next: NextFunction,
) => {
  if (process.env['PRERENDER'] === 'true') {
    next();
    return;
  }
  const tenantCookie =
    request.signedCookies?.['evorto-tenant'] ??
    request.cookies?.['evorto-tenant'];
  let tenant;
  if (tenantCookie) {
    tenant = await getTenant.execute({ domain: tenantCookie });
  }
  const referer = request.headers['referer'];
  const host = request.headers['x-forwarded-host'] || request.headers['host'];

  if (!tenant && host && typeof host === 'string') {
    const hostUrl = new URL(referer || `${request.protocol}://${host}`);
    const domain = hostUrl.hostname;
    tenant = await getTenant.execute({ domain });
  }

  if (tenant) {
    request.tenant = tenant;
    next();
  } else {
    next(new Error('Tenant not found'));
  }
};
