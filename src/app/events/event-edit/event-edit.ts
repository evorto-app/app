import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { form, submit } from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { Router, RouterLink } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import {
  faArrowLeft,
  faEllipsisVertical,
} from '@fortawesome/duotone-regular-svg-icons';
import {
  requireWritableRegistrationMode,
  writableRegistrationModes,
} from '@shared/registration-modes';
import { EventEditIconUsage } from '@shared/rpc-contracts/app-rpcs/icons.rpcs';
import {
  injectMutation,
  injectQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import consola from 'consola/browser';

import { ConfigService } from '../../core/config.service';
import { AppRpc } from '../../core/effect-rpc-angular-client';
import {
  resolveTenantRuntimeTimezone,
  tenantNow,
  toTenantDateTime,
} from '../../core/tenant-runtime';
import { EventGeneralForm } from '../../shared/components/forms/event-general-form/event-general-form';
import {
  createEventGeneralFormModel,
  EventGeneralFormModel,
  eventGeneralFormSchema,
} from '../../shared/components/forms/event-general-form/event-general-form.schema';
import { RegistrationOptionForm } from '../../shared/components/forms/registration-option-form/registration-option-form';
import { createRegistrationOptionFormModel } from '../../shared/components/forms/registration-option-form/registration-option-form.schema';
import { IfAnyPermissionDirective } from '../../shared/directives/if-any-permission.directive';

export const eventEditSubmitDisabled = ({
  formInvalid,
  formSubmitting,
  mutationPending,
}: {
  formInvalid: boolean;
  formSubmitting: boolean;
  mutationPending: boolean;
}): boolean => formInvalid || formSubmitting || mutationPending;

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FontAwesomeModule,
    IfAnyPermissionDirective,
    MatButtonModule,
    MatMenuModule,
    RouterLink,
    EventGeneralForm,
    RegistrationOptionForm,
  ],
  selector: 'app-event-edit',
  styles: ``,
  templateUrl: './event-edit.html',
})
export class EventEdit {
  public eventId = input.required<string>();
  private readonly rpc = AppRpc.injectClient();
  protected readonly discountProvidersQuery = injectQuery(() =>
    this.rpc.discounts.getTenantProviders.queryOptions(),
  );
  private readonly config = inject(ConfigService);
  private readonly tenantTimezone = resolveTenantRuntimeTimezone(
    this.config.tenantSignal()?.timezone,
  );
  protected readonly editEventModel = signal<EventGeneralFormModel>(
    createEventGeneralFormModel({}, this.tenantTimezone),
  );
  protected readonly editEventForm = form(
    this.editEventModel,
    eventGeneralFormSchema,
  );
  protected readonly esnEnabled = computed(() => {
    if (!this.discountProvidersQuery.isSuccess()) return false;
    const providers = this.discountProvidersQuery.data();
    return (
      providers.find((provider) => provider.type === 'esnCard')?.status ===
      'enabled'
    );
  });
  protected readonly eventEditSubmitDisabled = eventEditSubmitDisabled;
  protected readonly eventQuery = injectQuery(() =>
    this.rpc.events.findOneForEdit.queryOptions({ id: this.eventId() }),
  );
  protected readonly faArrowLeft = faArrowLeft;
  protected readonly faEllipsisVertical = faEllipsisVertical;
  protected readonly iconUsage = computed(() =>
    EventEditIconUsage.make({ eventId: this.eventId() }),
  );
  protected readonly registrationModes = writableRegistrationModes;
  protected readonly updateEventMutation = injectMutation(() =>
    this.rpc.events.update.mutationOptions(),
  );
  private queryClient = inject(QueryClient);
  private router = inject(Router);
  constructor() {
    effect(() => {
      if (!this.eventQuery.isSuccess()) {
        return;
      }

      const event = this.eventQuery.data();
      this.editEventModel.set(
        createEventGeneralFormModel({
          description: event.description,
          end: event.end
            ? toTenantDateTime(new Date(event.end), this.tenantTimezone)
            : tenantNow(this.tenantTimezone),
          icon: event.icon,
          location: event.location ?? null,
          registrationOptions: event.registrationOptions.map((option) =>
            createRegistrationOptionFormModel(
              {
                cancellationDeadlineHoursBeforeStart:
                  option.cancellationDeadlineHoursBeforeStart,
                closeRegistrationTime: option.closeRegistrationTime
                  ? toTenantDateTime(
                      new Date(option.closeRegistrationTime),
                      this.tenantTimezone,
                    )
                  : tenantNow(this.tenantTimezone),
                description: option.description ?? '',
                esnCardDiscountedPrice: option.esnCardDiscountedPrice ?? '',
                id: option.id,
                isPaid: option.isPaid,
                openRegistrationTime: option.openRegistrationTime
                  ? toTenantDateTime(
                      new Date(option.openRegistrationTime),
                      this.tenantTimezone,
                    )
                  : tenantNow(this.tenantTimezone),
                organizingRegistration: option.organizingRegistration,
                price: option.price,
                refundFeesOnCancellation: option.refundFeesOnCancellation,
                registeredDescription: option.registeredDescription ?? '',
                registrationMode: option.registrationMode,
                roleIds: option.roleIds ? [...option.roleIds] : [],
                spots: option.spots,
                stripeTaxRateId: option.stripeTaxRateId ?? null,
                title: option.title,
                transferDeadlineHoursBeforeStart:
                  option.transferDeadlineHoursBeforeStart,
              },
              this.tenantTimezone,
            ),
          ),
          start: event.start
            ? toTenantDateTime(new Date(event.start), this.tenantTimezone)
            : tenantNow(this.tenantTimezone),
          title: event.title,
        }),
      );
    });
  }
  protected async saveEvent(event: Event) {
    event.preventDefault();
    if (
      eventEditSubmitDisabled({
        formInvalid: this.editEventForm().invalid(),
        formSubmitting: this.editEventForm().submitting(),
        mutationPending: this.updateEventMutation.isPending(),
      })
    ) {
      return;
    }

    await submit(this.editEventForm, async (formState) => {
      const formValue = formState().value();

      if (
        !formValue.description ||
        !formValue.end ||
        !formValue.icon ||
        !formValue.start ||
        !formValue.title
      ) {
        return;
      }

      this.updateEventMutation.mutate(
        {
          description: formValue.description,
          end: formValue.end.toJSDate().toISOString(),
          eventId: this.eventId(),
          icon: formValue.icon,
          location: formValue.location,
          registrationOptions: formValue.registrationOptions.map(
            (registrationOption) => ({
              cancellationDeadlineHoursBeforeStart:
                registrationOption.cancellationDeadlineHoursBeforeStart,
              closeRegistrationTime: registrationOption.closeRegistrationTime
                .toJSDate()
                .toISOString(),
              description: registrationOption.description || null,
              esnCardDiscountedPrice:
                this.esnEnabled() && registrationOption.isPaid
                  ? registrationOption.esnCardDiscountedPrice === ''
                    ? null
                    : registrationOption.esnCardDiscountedPrice
                  : null,
              id: registrationOption.id,
              isPaid: registrationOption.isPaid,
              openRegistrationTime: registrationOption.openRegistrationTime
                .toJSDate()
                .toISOString(),
              organizingRegistration: registrationOption.organizingRegistration,
              price: registrationOption.price,
              refundFeesOnCancellation:
                registrationOption.refundFeesOnCancellation,
              registeredDescription:
                registrationOption.registeredDescription || null,
              registrationMode: requireWritableRegistrationMode(
                registrationOption.registrationMode,
              ),
              roleIds: registrationOption.roleIds,
              spots: registrationOption.spots,
              stripeTaxRateId: registrationOption.stripeTaxRateId,
              title: registrationOption.title,
              transferDeadlineHoursBeforeStart:
                registrationOption.transferDeadlineHoursBeforeStart,
            }),
          ),
          start: formValue.start.toJSDate().toISOString(),
          title: formValue.title,
        },
        {
          onError: (error) => {
            consola.error('Failed to update event:', error);
          },
          onSuccess: async ({ id }) => {
            await this.queryClient.invalidateQueries(
              this.rpc.queryFilter(['events', 'eventList']),
            );
            return this.router.navigate(['/events', id]);
          },
        },
      );
    });
  }
}
