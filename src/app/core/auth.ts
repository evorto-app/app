import { inject, Injectable, REQUEST_CONTEXT } from '@angular/core';
import { Router } from '@angular/router';
import { injectQuery } from '@tanstack/angular-query-experimental';

import type { Context } from '../../types/custom/context';

import { AppRpc } from './effect-rpc-angular-client';
import { injectTRPC } from './trpc-client';

@Injectable({
  providedIn: 'root',
})
export class Auth {
  private readonly rpc = AppRpc.injectClient();
  // Use tRPC queries with signals for a reactive state
  private isAuthenticatedQuery = injectQuery(() =>
    this.rpc.config.isAuthenticated.queryOptions(),
  );
  // Convert queries to signals
  isAuthenticated = this.isAuthenticatedQuery.data();
  private trpcClient = injectTRPC();

  private userQuery = injectQuery(() =>
    this.trpcClient.users.maybeSelf.queryOptions(),
  );
  user = this.userQuery.data();
  private permissionsQuery = injectQuery(() =>
    this.rpc.config.permissions.queryOptions(),
  );

  private requestContext = inject(REQUEST_CONTEXT) as Context | null;

  private router = inject(Router);

  async login(returnUrl?: string) {
    const redirectUrl = returnUrl || this.router.url;
    // On the server we can redirect with the router, on the client we have to replace the location
    if (this.requestContext) {
      await this.router.navigate(['/login'], {
        queryParams: { redirectUrl },
      });
    } else {
      globalThis.location.replace(`/login?redirectUrl=${redirectUrl}`);
    }
  }

  logout(): void {
    globalThis.location.href = '/logout';
  }

  // Refresh authentication state
  refresh(): void {
    this.isAuthenticatedQuery.refetch();
    this.userQuery.refetch();
    this.permissionsQuery.refetch();
  }
}
