import { ChangeDetectionStrategy, Component } from '@angular/core';
import { injectQuery } from '@tanstack/angular-query-experimental';

import { AppRpc } from '../../core/effect-rpc-angular-client';
import { globalAdminTenantRows } from './tenant-list.rows';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [],
  selector: 'app-tenant-list',
  styles: ``,
  templateUrl: './tenant-list.component.html',
})
export class TenantListComponent {
  private rpc = AppRpc.injectClient();
  protected tenantQuery = injectQuery(() =>
    this.rpc.globalAdmin.tenants.findMany.queryOptions(),
  );
  protected readonly tenantRows = globalAdminTenantRows;
}
