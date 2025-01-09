import { Component, inject } from '@angular/core';
import { injectQuery } from '@tanstack/angular-query-experimental';

import { QueriesService } from '../../core/queries.service';
import { injectTrpcClient } from '../../core/trpc-client';

@Component({
  imports: [],
  selector: 'app-tenant-list',
  styles: ``,
  templateUrl: './tenant-list.component.html',
})
export class TenantListComponent {
  private queries = inject(QueriesService);
  protected tenantQuery = injectQuery(this.queries.tenants());
}
