import { DatePipe } from '@angular/common';
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
export class PlatformEventsOperations {
  private readonly rpc = AppRpc.injectClient();

  list(targetTenantId: string) {
    return this.rpc.platform.events.list.queryOptions({ targetTenantId });
  }
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    MatButtonModule,
    PlatformTenantPageHeaderComponent,
    RouterLink,
  ],
  selector: 'app-platform-events',
  templateUrl: './platform-events.component.html',
})
export class PlatformEventsComponent {
  readonly tenantId = input.required<string>();

  private readonly operations = inject(PlatformEventsOperations);
  protected readonly eventsQuery = injectQuery(() =>
    this.operations.list(this.tenantId()),
  );

  protected errorMessage(error: unknown): string {
    return getErrorMessage(error, 'Failed to load target-tenant events');
  }
}
