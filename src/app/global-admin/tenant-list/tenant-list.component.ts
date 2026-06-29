import {
  ChangeDetectionStrategy,
  Component,
  computed,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { RouterLink } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { faArrowRight, faPlus } from '@fortawesome/duotone-regular-svg-icons';
import { injectQuery } from '@tanstack/angular-query-experimental';

import { AppRpc } from '../../core/effect-rpc-angular-client';
import {
  filterGlobalAdminTenants,
  globalAdminTenantListErrorMessage,
  globalAdminTenantRows,
} from './tenant-list.rows';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FontAwesomeModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    RouterLink,
  ],
  selector: 'app-tenant-list',
  styles: ``,
  templateUrl: './tenant-list.component.html',
})
export class TenantListComponent {
  protected readonly faArrowRight = faArrowRight;
  protected readonly faPlus = faPlus;
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
  protected readonly tenantListErrorMessage = globalAdminTenantListErrorMessage;
  protected readonly tenantRows = globalAdminTenantRows;

  protected updateTenantSearch(event: Event): void {
    const target = event.target;
    this.tenantSearch.set(
      target instanceof HTMLInputElement ? target.value : '',
    );
  }
}
