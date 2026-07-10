import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { faArrowLeft } from '@fortawesome/duotone-regular-svg-icons';
import { injectQuery } from '@tanstack/angular-query-experimental';

import { AppRpc } from '../../core/effect-rpc-angular-client';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FontAwesomeModule, MatButtonModule, RouterLink],
  selector: 'app-platform-tenant-page-header',
  template: `
    <header class="mb-6 flex items-start gap-3">
      <a
        mat-icon-button
        aria-label="Back to tenant"
        [routerLink]="['/global-admin/tenants', tenantId()]"
      >
        <fa-duotone-icon [icon]="faArrowLeft" />
      </a>
      <div class="min-w-0">
        <h1 class="title-large">{{ title() }}</h1>
        <p class="body-medium text-on-surface-variant mt-1 break-words">
          @if (tenantQuery.isSuccess() && tenantQuery.data(); as tenant) {
            {{ tenant.name }} · <span class="font-mono">{{ tenant.id }}</span>
          } @else {
            Tenant <span class="font-mono">{{ tenantId() }}</span>
          }
        </p>
      </div>
    </header>
  `,
})
export class PlatformTenantPageHeaderComponent {
  readonly tenantId = input.required<string>();
  readonly title = input.required<string>();

  protected readonly faArrowLeft = faArrowLeft;
  private readonly rpc = AppRpc.injectClient();
  protected readonly tenantQuery = injectQuery(() =>
    this.rpc.globalAdmin.tenants.findOne.queryOptions({ id: this.tenantId() }),
  );
}
