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
import { registrationModes } from '@shared/registration-modes';
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
  eventGeneralFormSchemaWithPaymentAvailability,
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

  taxRates() {
    return this.rpc.taxRates.listActive.queryOptions();
  }
}

export const templateCreateEventSubmitDisabled = ({
  discountProvidersReady,
  formInvalid,
  formSubmitting,
  mutationPending,
  paidGraphBlocked,
  taxRatesReady,
}: {
  discountProvidersReady: boolean;
  formInvalid: boolean;
  formSubmitting: boolean;
  mutationPending: boolean;
  paidGraphBlocked: boolean;
  taxRatesReady: boolean;
}): boolean =>
  !discountProvidersReady ||
  !taxRatesReady ||
  formInvalid ||
  formSubmitting ||
  mutationPending ||
  paidGraphBlocked;

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
  protected readonly taxRatesQuery = injectQuery(() =>
    this.operations.taxRates(),
  );
  protected readonly availableTaxRates = computed(() =>
    this.taxRatesQuery.isSuccess() && !this.taxRatesQuery.isFetching()
      ? this.taxRatesQuery.data()
      : undefined,
  );
  private readonly config = inject(ConfigService);
  private readonly tenantTimezone = resolveTenantRuntimeTimezone(
    this.config.tenantSignal()?.timezone,
  );
  protected readonly createEventModel = signal<EventGeneralFormModel>(
    createEventGeneralFormModel({}, this.tenantTimezone),
  );
  protected readonly stripeConnected = computed(() =>
    Boolean(this.config.tenantSignal()?.stripeAccountId),
  );
  protected readonly createEventForm = form(
    this.createEventModel,
    eventGeneralFormSchemaWithPaymentAvailability(() => this.stripeConnected()),
  );
  protected readonly createEventMutation = injectMutation(() =>
    this.operations.createEvent(),
  );
  protected readonly discountProvidersQuery = injectQuery(() =>
    this.operations.discountProviders(),
  );
  protected readonly discountProviderState = computed(() => {
    if (this.discountProvidersQuery.isError()) return 'error' as const;
    if (
      !this.discountProvidersQuery.isSuccess() ||
      this.discountProvidersQuery.isFetching()
    ) {
      return 'loading' as const;
    }
    return this.discountProvidersQuery
      .data()
      .some(
        (provider) =>
          provider.type === 'esnCard' && provider.status === 'enabled',
      )
      ? ('esnEnabled' as const)
      : ('ready' as const);
  });
  protected readonly discountProvidersReady = computed(
    () =>
      this.discountProviderState() === 'ready' ||
      this.discountProviderState() === 'esnEnabled',
  );
  protected readonly esnEnabled = computed(
    () => this.discountProviderState() === 'esnEnabled',
  );
  protected readonly faArrowLeft = faArrowLeft;
  protected readonly faCircleInfo = faCircleInfo;
  protected readonly iconUsage = EventCreateIconUsage.make({});
  protected readonly stripeConnectionKnown = computed(
    () => this.config.tenantSignal() !== null,
  );
  protected readonly paidControlsUnavailable = computed(
    () => this.stripeConnectionKnown() && !this.stripeConnected(),
  );
  protected readonly paidGraphBlocked = computed(
    () =>
      this.paidControlsUnavailable() &&
      this.createEventModel().registrationOptions.some(
        (option) => option.isPaid,
      ),
  );
  protected readonly registrationModes = registrationModes;
  protected readonly taxRatesReady = computed(
    () => this.availableTaxRates() !== undefined,
  );
  protected readonly taxRateState = computed(() =>
    this.taxRatesQuery.isError()
      ? ('error' as const)
      : this.availableTaxRates() === undefined
        ? ('loading' as const)
        : ('ready' as const),
  );
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

      const startDateTime = this.toDateTime(
        untracked(() => this.createEventForm.start().value()),
      );
      const model = createEventFormModelFromTemplate(template, startDateTime);
      this.createEventModel.set(model);
      this.lastStart.set(startDateTime);
      this.initializedTemplateId.set(template.id);
    });
    effect(() => {
      if (!this.templateQuery.isSuccess()) return;
      const template = this.templateQuery.data();
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
        discountProvidersReady: this.discountProvidersReady(),
        formInvalid: this.createEventForm().invalid(),
        formSubmitting: this.createEventForm().submitting(),
        mutationPending: this.createEventMutation.isPending(),
        paidGraphBlocked: this.paidGraphBlocked(),
        taxRatesReady: this.taxRatesReady(),
      })
    ) {
      return;
    }

    await submit(this.createEventForm, async (formState) => {
      if (!this.discountProvidersReady() || !this.taxRatesReady()) return;
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
            registrationMode: option.registrationMode,
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
