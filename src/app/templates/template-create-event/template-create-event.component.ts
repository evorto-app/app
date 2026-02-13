import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { FieldTree, form, submit } from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { Router, RouterLink } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { faArrowLeft } from '@fortawesome/duotone-regular-svg-icons';
import {
  injectMutation,
  injectQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { DateTime } from 'luxon';

import { AppRpc } from '../../core/effect-rpc-angular-client';
import { injectTRPC } from '../../core/trpc-client';
import { EventGeneralForm } from '../../shared/components/forms/event-general-form/event-general-form';
import {
  createEventGeneralFormModel,
  EventGeneralFormModel,
  eventGeneralFormSchema,
} from '../../shared/components/forms/event-general-form/event-general-form.schema';
import { RegistrationOptionForm } from '../../shared/components/forms/registration-option-form/registration-option-form';
import { createRegistrationOptionFormModel } from '../../shared/components/forms/registration-option-form/registration-option-form.schema';

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
  protected readonly createEventModel = signal<EventGeneralFormModel>(
    createEventGeneralFormModel(),
  );
  protected readonly createEventForm = form(
    this.createEventModel,
    eventGeneralFormSchema,
  );
  private readonly rpc = AppRpc.injectClient();
  protected readonly createEventMutation = injectMutation(() =>
    this.rpc.events.create.mutationOptions(),
  );
  protected readonly discountProvidersQuery = injectQuery(() =>
    this.rpc.discounts.getTenantProviders.queryOptions(),
  );
  protected readonly esnEnabled = computed(() => {
    const providers = this.discountProvidersQuery.data();
    if (!providers) return false;
    return providers.find((provider) => provider.type === 'esnCard')?.status === 'enabled';
  });
  protected readonly faArrowLeft = faArrowLeft;
  protected readonly registrationModes = [
    'fcfs',
    'random',
    'application',
  ] as const;
  protected readonly templateId = input.required<string>();
  private trpc = injectTRPC();
  protected readonly templateQuery = injectQuery(() =>
    this.trpc.templates.findOne.queryOptions({ id: this.templateId() }),
  );
  private readonly initializedTemplateId = signal<null | string>(
    // eslint-disable-next-line unicorn/no-null
    null,
  );
  private readonly lastStart = signal<DateTime | null>(
    // eslint-disable-next-line unicorn/no-null
    null,
  );

  private readonly queryClient = inject(QueryClient);
  private readonly router = inject(Router);

  constructor() {
    effect(() => {
      const template = this.templateQuery.data();
      if (!template) return;
      if (this.initializedTemplateId() === template.id) return;

      const startDateTime = this.toDateTime(
        untracked(() => this.createEventForm.start().value()),
      );
      this.createEventModel.set(
        createEventGeneralFormModel({
          description: template.description,
          end: startDateTime,
          icon: template.icon,
          // eslint-disable-next-line unicorn/no-null
          location: template.location ?? null,
          registrationOptions: template.registrationOptions.map((option) =>
            createRegistrationOptionFormModel({
              closeRegistrationTime: startDateTime.minus({
                hours: option.closeRegistrationOffset,
              }),
              description: option.description ?? '',
              // Preserve source option id only for local form tracking.
              id: option.id,
              isPaid: option.isPaid,
              openRegistrationTime: startDateTime.minus({
                hours: option.openRegistrationOffset,
              }),
              organizingRegistration: option.organizingRegistration,
              price: option.price,
              registeredDescription: option.registeredDescription ?? '',
              registrationMode: option.registrationMode,
              roleIds: option.roleIds ?? [],
              spots: option.spots,
              // eslint-disable-next-line unicorn/no-null
              stripeTaxRateId: option.stripeTaxRateId ?? null,
              title: option.title,
            }),
          ),
          start: startDateTime,
          title: template.title,
        }),
      );
      this.lastStart.set(startDateTime);
      this.initializedTemplateId.set(template.id);
    });
    effect(() => {
      const template = this.templateQuery.data();
      const eventStart = this.createEventForm.start().value();
      const registrationOptions = this.createEventModel().registrationOptions;
      if (!template || !eventStart || registrationOptions.length === 0) return;
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
            closeRegistrationTime: this.toDateTime(
              option.closeRegistrationTime,
            )
              .toJSDate()
              .toISOString(),
            description: option.description?.trim()
              ? option.description
              : // eslint-disable-next-line unicorn/no-null
                null,
            isPaid: option.isPaid,
            openRegistrationTime: this.toDateTime(
              option.openRegistrationTime,
            )
              .toJSDate()
              .toISOString(),
            organizingRegistration: option.organizingRegistration,
            price: option.price,
            registeredDescription: option.registeredDescription?.trim()
              ? option.registeredDescription
              : // eslint-disable-next-line unicorn/no-null
                null,
            registrationMode: option.registrationMode,
            roleIds: option.roleIds,
            spots: option.spots,
            stripeTaxRateId: option.stripeTaxRateId?.trim()
              ? option.stripeTaxRateId
              : // eslint-disable-next-line unicorn/no-null
                null,
            title: option.title,
          })),
          start: this.toDateTime(formValue.start).toJSDate().toISOString(),
          templateId: this.templateId(),
        },
        {
          onSuccess: async (data) => {
            await this.queryClient.invalidateQueries(
              this.rpc.queryFilter(['events', 'eventList']),
            );
            this.router.navigate(['/events', data.id]);
          },
        },
      );
    });
  }

  private toDateTime(value: Date | DateTime): DateTime {
    return DateTime.isDateTime(value) ? value : DateTime.fromJSDate(value);
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
