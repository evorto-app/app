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
import { EventStatusComponent } from '../../shared/components/event-status/event-status.component';
import { PlatformTenantPageHeaderComponent } from '../platform-tenant-admin/platform-tenant-page-header.component';
import { platformEventInstantToDisplayDateTime } from './platform-event-date-time';

@Injectable({ providedIn: 'root' })
export class PlatformEventsOperations {
  private readonly rpc = AppRpc.injectClient();

  formOptions(targetTenantId: string) {
    return this.rpc.platform.events.formOptions.queryOptions({
      targetTenantId,
    });
  }

  list(targetTenantId: string) {
    return this.rpc.platform.events.list.queryOptions({ targetTenantId });
  }
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    EventStatusComponent,
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
  protected readonly targetTenantOptionsQuery = injectQuery(() =>
    this.operations.formOptions(this.tenantId()),
  );

  protected displayDateTime(value: string): string {
    return this.targetTenantOptionsQuery.isSuccess()
      ? platformEventInstantToDisplayDateTime(
          value,
          this.targetTenantOptionsQuery.data().timezone,
        )
      : '';
  }
}
