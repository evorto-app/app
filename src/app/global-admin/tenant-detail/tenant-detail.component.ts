import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { faArrowLeft } from '@fortawesome/duotone-regular-svg-icons';
import { injectQuery } from '@tanstack/angular-query-experimental';

import { AppRpc } from '../../core/effect-rpc-angular-client';
import { getErrorMessage } from '../../core/error-message';
import { globalAdminTenantRows } from '../tenant-list/tenant-list.rows';

export const globalAdminTenantDomainUrl = (domain: string): null | string => {
  const normalizedDomain = domain.trim().toLowerCase();
  if (!normalizedDomain || normalizedDomain.includes('://')) {
    return null;
  }

  try {
    const url = new URL(`https://${normalizedDomain}`);
    if (
      !url.hostname ||
      url.pathname !== '/' ||
      url.port ||
      url.search ||
      url.hash ||
      url.username ||
      url.password
    ) {
      return null;
    }

    return `https://${url.hostname}`;
  } catch {
    return null;
  }
};

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FontAwesomeModule, MatButtonModule, RouterLink],
  selector: 'app-tenant-detail',
  styles: ``,
  templateUrl: './tenant-detail.component.html',
})
export class TenantDetailComponent {
  readonly tenantId = input.required<string>();
  protected readonly faArrowLeft = faArrowLeft;
  protected readonly tenantDomainUrl = globalAdminTenantDomainUrl;

  private readonly rpc = AppRpc.injectClient();
  protected readonly tenantQuery = injectQuery(() =>
    this.rpc.globalAdmin.tenants.findOne.queryOptions({
      id: this.tenantId(),
    }),
  );
  protected readonly tenantRows = globalAdminTenantRows;

  protected errorMessage(error: unknown): string {
    return getErrorMessage(error, 'Failed to load tenant');
  }
}
