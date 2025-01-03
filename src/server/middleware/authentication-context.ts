import { NextFunction, Request, Response } from 'express';

export const addAuthenticationContext = async (
  request: Request,
  response: Response,
  next: NextFunction,
) => {
  request.authentication = {
    isAuthenticated: request.oidc.isAuthenticated(),
  };
  next();
};
