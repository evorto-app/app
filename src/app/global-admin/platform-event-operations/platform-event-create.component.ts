import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  Injectable,
  input,
  signal,
  untracked,
} from '@angular/core';
import {
  form,
  FormField,
  maxLength,
  required,
  submit,
  validate,
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
import { NotificationService } from '../../core/notification.service';
import { PlatformTenantPageHeaderComponent } from '../platform-tenant-admin/platform-tenant-page-header.component';
import {
  platformEventInstantToLocalDateTime,
  platformEventLocalDateTimeRangeHasValidOrder,
  platformEventLocalDateTimeToInstant,
} from './platform-event-date-time';

interface PlatformEventCreateFormModel {
  creatorUserId: string;
  description: string;
  end: string;
  reason: string;
  start: string;
  templateId: string;
  title: string;
}

const emptyCreateModel = (): PlatformEventCreateFormModel => ({
  creatorUserId: '',
  description: '',
  end: '',
  reason: '',
  start: '',
  templateId: '',
  title: '',
});

const initialCreateModel = (
  timezone: Parameters<typeof platformEventInstantToLocalDateTime>[1],
): PlatformEventCreateFormModel => {
  const start = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
  return {
    creatorUserId: '',
    description: '',
    end: platformEventInstantToLocalDateTime(end, timezone),
    reason: '',
    start: platformEventInstantToLocalDateTime(start, timezone),
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

  private readonly operations = inject(PlatformEventCreateOperations);
  protected readonly optionsQuery = injectQuery(() =>
    this.operations.formOptions(this.tenantId()),
  );
  private readonly createModel = signal(emptyCreateModel());
  protected readonly createForm = form(this.createModel, (event) => {
    required(event.creatorUserId, {
      message: 'Select an organization member.',
    });
    required(event.templateId, { message: 'Select an organization template.' });
    required(event.title, { message: 'Enter an event title.' });
    maxLength(event.title, 200, {
      message: 'Title must be 200 characters or fewer.',
    });
    required(event.description, { message: 'Enter an event description.' });
    required(event.start, { message: 'Enter a start date and time.' });
    required(event.end, { message: 'Enter an end date and time.' });
    validate(event.end, ({ value, valueOf }) => {
      if (!this.optionsQuery.isSuccess()) return;
      return platformEventLocalDateTimeRangeHasValidOrder(
        valueOf(event.start),
        value(),
        this.optionsQuery.data().timezone,
      ) === false
        ? {
            kind: 'dateOrder',
            message: 'The event must end after it starts.',
          }
        : undefined;
    });
    required(event.reason, { message: 'Enter an operational reason.' });
    maxLength(event.reason, 500, {
      message: 'Reason must be 500 characters or fewer.',
    });
  });
  protected readonly createMutation = injectMutation(() =>
    this.operations.create(),
  );
  private readonly initializedTenantId = signal<null | string>(null);
  private readonly notifications = inject(NotificationService);
  private readonly queryClient = inject(QueryClient);
  private readonly router = inject(Router);

  constructor() {
    effect(() => {
      if (!this.optionsQuery.isSuccess()) return;
      const tenantId = this.tenantId();
      if (this.initializedTenantId() === tenantId) return;
      const timezone = this.optionsQuery.data().timezone;

      untracked(() => {
        this.createModel.set(initialCreateModel(timezone));
        this.createForm().reset();
        this.initializedTenantId.set(tenantId);
      });
    });
  }

  protected save(event: Event): void {
    event.preventDefault();
    if (this.createMutation.isPending() || !this.optionsQuery.isSuccess()) {
      return;
    }
    const timezone = this.optionsQuery.data().timezone;

    void submit(this.createForm, async () => {
      const value = this.createModel();
      const end = platformEventLocalDateTimeToInstant(value.end, timezone);
      const start = platformEventLocalDateTimeToInstant(value.start, timezone);
      if (!end || !start) {
        this.notifications.showError(
          "Enter valid event times in the organization's time zone, including daylight-saving transitions.",
        );
        return;
      }
      try {
        const created = await this.createMutation.mutateAsync({
          ...value,
          end,
          start,
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
      } catch {
        this.notifications.showError(
          'The event could not be created. Review the details and try again.',
        );
      }
    });
  }
}
