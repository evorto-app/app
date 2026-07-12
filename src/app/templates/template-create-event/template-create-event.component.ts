import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  Injectable,
  input,
  signal,
  untracked,
} from '@angular/core';
import { FieldTree, form, submit } from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { Router, RouterLink } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import {
  faArrowLeft,
  faCircleInfo,
} from '@fortawesome/duotone-regular-svg-icons';
import {
  requireWritableRegistrationMode,
  writableRegistrationModes,
} from '@shared/registration-modes';
import { EventCreateIconUsage } from '@shared/rpc-contracts/app-rpcs/icons.rpcs';
import {
  injectMutation,
  injectQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { DateTime } from 'luxon';

import { ConfigService } from '../../core/config.service';
import { AppRpc } from '../../core/effect-rpc-angular-client';
import { getErrorMessage } from '../../core/error-message';
import {
  resolveTenantRuntimeTimezone,
  toTenantDateTime,
} from '../../core/tenant-runtime';
import { EventGeneralForm } from '../../shared/components/forms/event-general-form/event-general-form';
import {
  createEventGeneralFormModel,
  EventGeneralFormModel,
  eventGeneralFormSchema,
} from '../../shared/components/forms/event-general-form/event-general-form.schema';
import { RegistrationOptionForm } from '../../shared/components/forms/registration-option-form/registration-option-form';
import { createEventFormModelFromTemplate } from './template-create-event.mapper';

@Injectable({ providedIn: 'root' })
export class TemplateCreateEventOperations {
  private readonly rpc = AppRpc.injectClient();

  createEvent() {
    return this.rpc.events.create.mutationOptions();
  }

  discountProviders() {
    return this.rpc.discounts.getTenantProviders.queryOptions();
  }

  eventListFilter() {
    return this.rpc.queryFilter(['events', 'eventList']);
  }

  findTemplate(id: string) {
    return this.rpc.templates.findOne.queryOptions({ id });
  }
}

export const templateCreateEventSubmitDisabled = ({
  formInvalid,
  formSubmitting,
  legacyRandomBlocked,
  mutationPending,
}: {
  formInvalid: boolean;
  formSubmitting: boolean;
  legacyRandomBlocked: boolean;
  mutationPending: boolean;
}): boolean =>
  formInvalid || formSubmitting || legacyRandomBlocked || mutationPending;

export const templateHasLegacyRandomRegistration = (
  registrationOptions: readonly { registrationMode: string }[],
): boolean =>
  registrationOptions.some((option) => option.registrationMode === 'random');

export const legacyRandomTemplateEventMessage =
  'This template uses legacy random allocation. It remains readable, but an event cannot be created from it until the registration configuration is explicitly migrated to a supported mode.';

export const templateAddOnCopyNotice = (addOnCount: number): null | string =>
  addOnCount > 0
    ? `This template has ${addOnCount} reusable add-on${addOnCount === 1 ? '' : 's'}. Event creation copies them to event registration cards for registration-time purchase.`
    : null;

export const templateCreateEventErrorMessage = (error: unknown): string =>
  getErrorMessage(
    error,
    'The event could not be created. Review the form and try again.',
  );

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FontAwesomeModule,
    MatButtonModule,
    RouterLink,
    RegistrationOptionForm,
    EventGeneralForm,
  ],
  templateUrl: './template-create-event.component.html',
})
export class TemplateCreateEventComponent {
  protected readonly templateId = input.required<string>();
  private readonly operations = inject(TemplateCreateEventOperations);
  protected readonly templateQuery = injectQuery(() =>
    this.operations.findTemplate(this.templateId()),
  );
  protected readonly addOnCopyNotice = computed(() =>
    templateAddOnCopyNotice(
      this.templateQuery.isSuccess()
        ? this.templateQuery.data().addOns.length
        : 0,
    ),
  );
  private readonly config = inject(ConfigService);
  private readonly tenantTimezone = resolveTenantRuntimeTimezone(
    this.config.tenantSignal()?.timezone,
  );
  protected readonly createEventModel = signal<EventGeneralFormModel>(
    createEventGeneralFormModel({}, this.tenantTimezone),
  );
  protected readonly createEventForm = form(
    this.createEventModel,
    eventGeneralFormSchema,
  );
  protected readonly createEventMutation = injectMutation(() =>
    this.operations.createEvent(),
  );
  protected readonly discountProvidersQuery = injectQuery(() =>
    this.operations.discountProviders(),
  );
  protected readonly esnEnabled = computed(() => {
    if (!this.discountProvidersQuery.isSuccess()) return false;
    const providers = this.discountProvidersQuery.data();
    return (
      providers.find((provider) => provider.type === 'esnCard')?.status ===
      'enabled'
    );
  });
  protected readonly faArrowLeft = faArrowLeft;
  protected readonly faCircleInfo = faCircleInfo;
  protected readonly iconUsage = EventCreateIconUsage.make({});
  protected readonly legacyRandomBlocked = computed(
    () =>
      this.templateQuery.isSuccess() &&
      templateHasLegacyRandomRegistration(
        this.templateQuery.data().registrationOptions,
      ),
  );
  protected readonly legacyRandomTemplateEventMessage =
    legacyRandomTemplateEventMessage;
  protected readonly registrationModes = writableRegistrationModes;
  protected readonly templateCreateEventSubmitDisabled =
    templateCreateEventSubmitDisabled;
  private readonly initializedTemplateId = signal<null | string>(null);
  private readonly lastStart = signal<DateTime | null>(null);

  private readonly queryClient = inject(QueryClient);
  private readonly router = inject(Router);

  constructor() {
    effect(() => {
      if (!this.templateQuery.isSuccess()) return;
      const template = this.templateQuery.data();
      if (this.initializedTemplateId() === template.id) return;
      if (templateHasLegacyRandomRegistration(template.registrationOptions)) {
        this.initializedTemplateId.set(template.id);
        return;
      }

      const startDateTime = this.toDateTime(
        untracked(() => this.createEventForm.start().value()),
      );
      this.createEventModel.set(
        createEventFormModelFromTemplate(template, startDateTime),
      );
      this.lastStart.set(startDateTime);
      this.initializedTemplateId.set(template.id);
    });
    effect(() => {
      if (!this.templateQuery.isSuccess()) return;
      const template = this.templateQuery.data();
      if (templateHasLegacyRandomRegistration(template.registrationOptions)) {
        return;
      }
      const eventStart = this.createEventForm.start().value();
      const registrationOptions = this.createEventModel().registrationOptions;
      if (!eventStart || registrationOptions.length === 0) return;
      const startDateTime = this.toDateTime(eventStart);
      const previousStart = this.lastStart();
      this.lastStart.set(startDateTime);

      const endField = this.createEventForm.end;
      const endState = endField();
      if (previousStart && !endState.dirty() && !endState.touched()) {
        const currentEnd = this.toDateTime(endState.value());
        const durationMs = currentEnd.toMillis() - previousStart.toMillis();
        const nextEnd = startDateTime.plus({ milliseconds: durationMs });
        this.updateIfPristine(endField, nextEnd);
      }

      for (const [index, option] of template.registrationOptions.entries()) {
        const optionForm = this.createEventForm.registrationOptions[index];
        if (!optionForm) continue;
        const openRegistrationTime = startDateTime.minus({
          hours: option.openRegistrationOffset,
        });
        const closeRegistrationTime = startDateTime.minus({
          hours: option.closeRegistrationOffset,
        });

        this.updateIfPristine(
          optionForm.openRegistrationTime,
          openRegistrationTime,
        );
        this.updateIfPristine(
          optionForm.closeRegistrationTime,
          closeRegistrationTime,
        );
      }
    });
  }

  async onSubmit(event: Event) {
    event.preventDefault();
    if (
      templateCreateEventSubmitDisabled({
        formInvalid: this.createEventForm().invalid(),
        formSubmitting: this.createEventForm().submitting(),
        legacyRandomBlocked: this.legacyRandomBlocked(),
        mutationPending: this.createEventMutation.isPending(),
      })
    ) {
      return;
    }

    await submit(this.createEventForm, async (formState) => {
      const formValue = formState().value();
      if (!formValue.icon) {
        return;
      }
      this.createEventMutation.mutate(
        {
          ...formValue,
          end: this.toDateTime(formValue.end).toJSDate().toISOString(),
          icon: formValue.icon,
          registrationOptions: formValue.registrationOptions.map((option) => ({
            cancellationDeadlineHoursBeforeStart:
              option.cancellationDeadlineHoursBeforeStart,
            closeRegistrationTime: this.toDateTime(option.closeRegistrationTime)
              .toJSDate()
              .toISOString(),
            description: option.description?.trim() ? option.description : null,
            isPaid: option.isPaid,
            openRegistrationTime: this.toDateTime(option.openRegistrationTime)
              .toJSDate()
              .toISOString(),
            organizingRegistration: option.organizingRegistration,
            price: option.price,
            refundFeesOnCancellation: option.refundFeesOnCancellation,
            registeredDescription: option.registeredDescription?.trim()
              ? option.registeredDescription
              : null,
            registrationMode: requireWritableRegistrationMode(
              option.registrationMode,
            ),
            roleIds: option.roleIds,
            sourceTemplateRegistrationOptionId: option.id || undefined,
            spots: option.spots,
            stripeTaxRateId: option.stripeTaxRateId?.trim()
              ? option.stripeTaxRateId
              : null,
            title: option.title,
            transferDeadlineHoursBeforeStart:
              option.transferDeadlineHoursBeforeStart,
          })),
          start: this.toDateTime(formValue.start).toJSDate().toISOString(),
          templateId: this.templateId(),
        },
        {
          onSuccess: async (data) => {
            await this.queryClient.invalidateQueries(
              this.operations.eventListFilter(),
            );
            this.router.navigate(['/events', data.id]);
          },
        },
      );
    });
  }

  protected createEventErrorMessage(): string {
    return templateCreateEventErrorMessage(this.createEventMutation.error());
  }

  private toDateTime(value: Date | DateTime): DateTime {
    return toTenantDateTime(value, this.tenantTimezone);
  }

  private updateIfPristine(
    field: FieldTree<DateTime>,
    nextValue: DateTime,
  ): void {
    const state = field();
    if (state.dirty() || state.touched()) return;
    const currentValue = state.value();
    if (currentValue.toMillis() === nextValue.toMillis()) return;
    state.reset(nextValue);
  }
}
