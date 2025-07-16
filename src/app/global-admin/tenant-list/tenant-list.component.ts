import { ChangeDetectionStrategy, Component } from '@angular/core';
import { injectQuery } from '@tanstack/angular-query-experimental';

import { injectTRPC } from '../../core/trpc-client';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [],
  selector: 'app-tenant-list',
  styles: ``,
  templateUrl: './tenant-list.component.html',
})
export class TenantListComponent {
  private trpc = injectTRPC();
  protected tenantQuery = injectQuery(() =>
    this.trpc.globalAdmin.tenants.findMany.queryOptions(),
  );
}
