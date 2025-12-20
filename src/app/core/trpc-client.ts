import { createTRPCInjectors } from '@heddendorp/tanstack-angular-query';

import { AppRouter } from '../../server/trpc/app-router';

export const { injectTRPC, injectTRPCClient } = createTRPCInjectors<AppRouter>();
