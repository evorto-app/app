import { NextFunction, Request, Response } from 'express';

import { getUser } from '../../db';

export const addUserContextMiddleware = async (
  request: Request,
  response: Response,
  next: NextFunction,
) => {
  if (!request.oidc.isAuthenticated()) {
    next();
    return;
  }
  const auth0Id = request.oidc.user?.['sub'];
  if (auth0Id) {
    const user = await getUser.execute({ auth0Id });
    if (user) {
      const permissions = user.usersToTenants
        .flatMap((ut) => ut.rolesToTenantUsers)
        .flatMap((rttu) => rttu.role.permissions);
      request.user = { ...user, permissions };
    }
  }
  next();
};
