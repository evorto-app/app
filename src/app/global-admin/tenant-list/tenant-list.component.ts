import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { injectQuery } from '@tanstack/angular-query-experimental';

import { QueriesService } from '../../core/queries.service';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [],
  selector: 'app-tenant-list',
  styles: ``,
  templateUrl: './tenant-list.component.html',
})
export class TenantListComponent {
  private queries = inject(QueriesService);
  protected tenantQuery = injectQuery(this.queries.tenants());
}
