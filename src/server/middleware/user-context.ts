import { uniq } from 'es-toolkit';
import { NextFunction, Request, Response } from 'express';

import { getUser, userAttributes } from '../../db';
import { ALL_PERMISSIONS } from '../../shared/permissions/permissions';

export const addUserContext = async (request: Request, response: Response, next: NextFunction) => {
  if (!request?.oidc?.isAuthenticated()) {
    next();
    return;
  }
  const auth0Id = request.oidc.user?.['sub'];
  if (auth0Id) {
    const user = await getUser.execute({
      auth0Id,
      tenantId: request.tenant.id,
    });
    if (user) {
      const appMetadata = request.oidc.user?.['evorto.app/app_metadata'];
      const permissions = appMetadata?.globalAdmin
        ? ([...ALL_PERMISSIONS, 'globalAdmin:manageTenants'] as const)
        : user.tenantAssignments
            .flatMap((assignment) => assignment.roles)
            .flatMap((role) => role.permissions);
      const roleIds = user.tenantAssignments
        .flatMap((assignment) => assignment.roles)
        .flatMap((role) => role.id);
      const attributeResponse = await userAttributes
        .execute({
          tenantId: request.tenant.id,
          userId: user.id,
        })
        .then((response) => response[0]);
      const attributes = [
        ...(attributeResponse?.organizesSome ? (['events:organizesSome'] as const) : []),
      ];
      request.user = {
        ...user,
        attributes,
        permissions: uniq(permissions),
        roleIds,
      };
    }
  }
  next();
};
