import { NextFunction, Request, Response } from 'express';

export const addAuthenticationContext = async (
  request: Request,
  _response: Response,
  next: NextFunction,
) => {
  request.authentication = {
    cookie: request.cookies['appSession'],
    isAuthenticated: request?.oidc?.isAuthenticated() ?? false,
  };
  next();
};
