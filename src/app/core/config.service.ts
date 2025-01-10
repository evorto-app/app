import { effect, inject, Injectable } from '@angular/core';
import { injectQuery } from '@tanstack/angular-query-experimental';

import { type Tenant } from '../../types/custom/tenant';
import { QueriesService } from './queries.service';

@Injectable({
  providedIn: 'root',
})
export class ConfigService {
  get currency() {
    if (!this.staticTenant) {
      throw new Error('No tenant found');
    }
    return this.staticTenant.currency;
  }
  private readonly queries = inject(QueriesService);

  private staticTenant?: Tenant;

  private tenantQuery = injectQuery(this.queries.currentTenant());

  constructor() {
    effect(() => {
      const tenant = this.tenantQuery.data();
      if (tenant) {
        this.staticTenant = tenant;
      }
    });
  }
}
