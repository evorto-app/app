import { InjectionToken } from '@angular/core';
import { TRPCClient } from '@trpc/client';

import { AppRouter } from '../../server/trpc/app-router';

export const TRPC_CLIENT = new InjectionToken<TRPCClient<AppRouter>>(
  'TRPC_CLIENT',
);
