import { Component } from '@angular/core';
import { injectQuery } from '@tanstack/angular-query-experimental';

import { injectTrpcClient } from '../../core/trpc-client';

@Component({
  imports: [],
  selector: 'app-tenant-list',
  styles: ``,
  templateUrl: './tenant-list.component.html',
})
export class TenantListComponent {
  private trpc = injectTrpcClient();
  protected tenantQuery = injectQuery(() => ({
    queryFn: () => this.trpc.tenants.findMany.query(),
    queryKey: ['tenants'],
  }));
}
