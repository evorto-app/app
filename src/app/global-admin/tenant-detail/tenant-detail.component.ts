import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { faArrowLeft } from '@fortawesome/duotone-regular-svg-icons';
import {
  deriveTenantPublicOrigin,
  normalizeTenantDomain,
} from '@shared/tenant-origin';
import { injectQuery } from '@tanstack/angular-query-experimental';

import { ConfigService } from '../../core/config.service';
import { AppRpc } from '../../core/effect-rpc-angular-client';
import { globalAdminTenantRows } from '../tenant-list/tenant-list.rows';

export const globalAdminTenantPublicOrigin = (
  domain: string,
  currentDomain?: string,
): null | string => {
  try {
    if (
      currentDomain &&
      normalizeTenantDomain(domain) === normalizeTenantDomain(currentDomain)
    )
      return '/';
    const origin = deriveTenantPublicOrigin(domain);
    const hostname = new URL(origin).hostname.toLowerCase();

    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '[::1]'
    ) {
      return null;
    }

    return origin;
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
  private readonly config = inject(ConfigService);
  protected readonly tenantPublicOrigin = (domain: string) =>
    globalAdminTenantPublicOrigin(domain, this.config.tenantSignal()?.domain);

  private readonly rpc = AppRpc.injectClient();
  protected readonly tenantQuery = injectQuery(() =>
    this.rpc.globalAdmin.tenants.findOne.queryOptions({
      id: this.tenantId(),
    }),
  );
  protected readonly tenantRows = globalAdminTenantRows;
}
