import {
  ChangeDetectionStrategy,
  Component,
  inject,
  Injectable,
  input,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import { injectQuery } from '@tanstack/angular-query-experimental';

import { AppRpc } from '../../core/effect-rpc-angular-client';
import { getErrorMessage } from '../../core/error-message';
import { PlatformTenantPageHeaderComponent } from '../platform-tenant-admin/platform-tenant-page-header.component';

@Injectable({ providedIn: 'root' })
export class PlatformTemplatesOperations {
  private readonly rpc = AppRpc.injectClient();

  list(targetTenantId: string) {
    return this.rpc.platform.templates.list.queryOptions({ targetTenantId });
  }
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, PlatformTenantPageHeaderComponent, RouterLink],
  selector: 'app-platform-templates',
  templateUrl: './platform-templates.component.html',
})
export class PlatformTemplatesComponent {
  readonly tenantId = input.required<string>();

  private readonly operations = inject(PlatformTemplatesOperations);
  protected readonly templatesQuery = injectQuery(() =>
    this.operations.list(this.tenantId()),
  );

  protected errorMessage(error: unknown): string {
    return getErrorMessage(error, 'Failed to load target-tenant templates');
  }
}
