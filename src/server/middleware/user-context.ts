import { NextFunction, Request, Response } from 'express';

import { getUser } from '../../db';

export const addUserContextMiddleware = async (
  request: Request,
  response: Response,
  next: NextFunction,
) => {
  if (!request.oidc.isAuthenticated()) {
    next();
  }
  const auth0Id = request.oidc.user?.['sub'];
  if (auth0Id) {
    const user = await getUser.execute({ auth0Id });
    if (user) {
      request.user = user;
    }
  }
  next();
};
