import { NextFunction, Request, Response } from 'express';

import { resolveAuthenticationContext } from '../context/request-context-resolver';

export const addAuthenticationContext = async (
  request: Request,
  _response: Response,
  next: NextFunction,
) => {
  request.authentication = resolveAuthenticationContext({
    appSessionCookie: request.cookies['appSession'],
    isAuthenticated: request?.oidc?.isAuthenticated() ?? false,
  });
  next();
};
