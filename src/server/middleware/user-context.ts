import { NextFunction, Request, Response } from 'express';

import { resolveUserContext } from '../context/request-context-resolver';

export const addUserContext = async (
  request: Request,
  response: Response,
  next: NextFunction,
) => {
  const user = await resolveUserContext({
    isAuthenticated: request?.oidc?.isAuthenticated() ?? false,
    oidcUser: request.oidc?.user,
    tenantId: request.tenant.id,
  });
  if (user) {
    request.user = user;
  }
  next();
};
