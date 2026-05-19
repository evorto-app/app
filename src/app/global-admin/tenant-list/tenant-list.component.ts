import {
  ChangeDetectionStrategy,
  Component,
  computed,
  signal,
} from '@angular/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { injectQuery } from '@tanstack/angular-query-experimental';

import { AppRpc } from '../../core/effect-rpc-angular-client';
import {
  filterGlobalAdminTenants,
  globalAdminTenantRows,
} from './tenant-list.rows';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatFormFieldModule, MatInputModule],
  selector: 'app-tenant-list',
  styles: ``,
  templateUrl: './tenant-list.component.html',
})
export class TenantListComponent {
  private rpc = AppRpc.injectClient();
  protected tenantQuery = injectQuery(() =>
    this.rpc.globalAdmin.tenants.findMany.queryOptions(),
  );
  protected readonly tenantSearch = signal('');
  protected readonly filteredTenants = computed(() =>
    filterGlobalAdminTenants(
      this.tenantQuery.data() ?? [],
      this.tenantSearch(),
    ),
  );
  protected readonly tenantRows = globalAdminTenantRows;

  protected updateTenantSearch(event: Event): void {
    const target = event.target;
    this.tenantSearch.set(
      target instanceof HTMLInputElement ? target.value : '',
    );
  }
}
