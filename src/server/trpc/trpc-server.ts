import { initTRPC, TRPCError } from '@trpc/server';
import { Request } from 'express';
import superjson from 'superjson';

import { type Permission } from '../../shared/permissions/permissions';
import { type Context } from '../../types/custom/context';

interface Meta {
  requiredPermissions?: Permission[];
}

const t = initTRPC
  .context<Context & { request: Request }>()
  .meta<Meta>()
  .create({ transformer: superjson });

export const router = t.router;
export const publicProcedure = t.procedure;
export const createCallerFactory = t.createCallerFactory;

const enforceAuth = t.middleware(async ({ ctx, meta, next, path }) => {
  if (!ctx.user) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: `Cannot access ${path}`,
    });
  }

  if (meta?.requiredPermissions?.length) {
    const hasRequiredPermissions = meta.requiredPermissions.every(
      (permission) => ctx.user?.permissions.includes(permission),
    );

    if (!hasRequiredPermissions) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'You do not have the required permissions for this action',
      });
    }
  }

  return next({
    ctx: {
      user: ctx.user,
    },
  });
});

export const authenticatedProcedure = t.procedure.use(enforceAuth);
