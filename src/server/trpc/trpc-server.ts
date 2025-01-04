import { initTRPC } from '@trpc/server';
import superjson from 'superjson';

import { type Context } from '../../types/custom/context';

const t = initTRPC.context<Context>().create({ transformer: superjson });
export const router = t.router;
export const publicProcedure = t.procedure;
export const authenticatedProcedure = publicProcedure.use(async (options) => {
  if (!options.ctx.user) {
    throw new Error('Unauthorized');
  }
  return options.next({
    ctx: {
      user: options.ctx.user,
    },
  });
});
