import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { faArrowLeft } from '@fortawesome/duotone-regular-svg-icons';
import { normalizeTenantCanonicalRootUrl } from '@shared/tenant-origin';
import { injectQuery } from '@tanstack/angular-query-experimental';

import { AppRpc } from '../../core/effect-rpc-angular-client';
import { getErrorMessage } from '../../core/error-message';
import { globalAdminTenantRows } from '../tenant-list/tenant-list.rows';

export const globalAdminTenantCanonicalRootUrl = (
  canonicalRootUrl: string,
  domain: string,
): null | string => {
  try {
    return normalizeTenantCanonicalRootUrl(canonicalRootUrl, domain);
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
  protected readonly tenantCanonicalRootUrl = globalAdminTenantCanonicalRootUrl;

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
