import {
  ChangeDetectionStrategy,
  Component,
  inject,
  Injectable,
  input,
  signal,
} from '@angular/core';
import {
  form,
  FormField,
  maxLength,
  required,
  submit,
} from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { Router, RouterLink } from '@angular/router';
import {
  injectMutation,
  injectQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';

import { AppRpc } from '../../core/effect-rpc-angular-client';
import { getErrorMessage } from '../../core/error-message';
import { NotificationService } from '../../core/notification.service';
import { PlatformTenantPageHeaderComponent } from '../platform-tenant-admin/platform-tenant-page-header.component';

interface PlatformEventCreateFormModel {
  creatorUserId: string;
  description: string;
  end: string;
  reason: string;
  start: string;
  templateId: string;
  title: string;
}

const localDateTimeValue = (date: Date): string => {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
};

const initialCreateModel = (): PlatformEventCreateFormModel => {
  const start = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
  return {
    creatorUserId: '',
    description: '',
    end: localDateTimeValue(end),
    reason: '',
    start: localDateTimeValue(start),
    templateId: '',
    title: '',
  };
};

@Injectable({ providedIn: 'root' })
export class PlatformEventCreateOperations {
  private readonly rpc = AppRpc.injectClient();

  create() {
    return this.rpc.platform.events.create.mutationOptions();
  }

  formOptions(targetTenantId: string) {
    return this.rpc.platform.events.formOptions.queryOptions({
      targetTenantId,
    });
  }

  listFilter() {
    return this.rpc.queryFilter(['platform', 'events', 'list']);
  }
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormField,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    PlatformTenantPageHeaderComponent,
    RouterLink,
  ],
  selector: 'app-platform-event-create',
  templateUrl: './platform-event-create.component.html',
})
export class PlatformEventCreateComponent {
  readonly tenantId = input.required<string>();

  private readonly createModel = signal(initialCreateModel());
  protected readonly createForm = form(this.createModel, (event) => {
    required(event.creatorUserId, {
      message: 'Select a target-tenant member.',
    });
    required(event.templateId, { message: 'Select a target-tenant template.' });
    required(event.title, { message: 'Enter an event title.' });
    maxLength(event.title, 200, {
      message: 'Title must be 200 characters or fewer.',
    });
    required(event.description, { message: 'Enter an event description.' });
    required(event.start, { message: 'Enter a start date and time.' });
    required(event.end, { message: 'Enter an end date and time.' });
    required(event.reason, { message: 'Enter an operational reason.' });
    maxLength(event.reason, 500, {
      message: 'Reason must be 500 characters or fewer.',
    });
  });
  private readonly operations = inject(PlatformEventCreateOperations);
  protected readonly createMutation = injectMutation(() =>
    this.operations.create(),
  );
  protected readonly optionsQuery = injectQuery(() =>
    this.operations.formOptions(this.tenantId()),
  );
  private readonly notifications = inject(NotificationService);
  private readonly queryClient = inject(QueryClient);
  private readonly router = inject(Router);

  protected save(event: Event): void {
    event.preventDefault();
    if (this.createMutation.isPending()) return;

    void submit(this.createForm, async () => {
      const value = this.createModel();
      try {
        const created = await this.createMutation.mutateAsync({
          ...value,
          end: new Date(value.end).toISOString(),
          start: new Date(value.start).toISOString(),
          targetTenantId: this.tenantId(),
        });
        await this.queryClient.invalidateQueries(this.operations.listFilter());
        this.notifications.showSuccess('Event created');
        await this.router.navigate([
          '/global-admin/tenants',
          this.tenantId(),
          'events',
          created.id,
        ]);
      } catch (error) {
        this.notifications.showError(
          getErrorMessage(error, 'Failed to create event'),
        );
      }
    });
  }
}
