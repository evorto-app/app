import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  signal,
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
import consola from 'consola/browser';
import { DateTime } from 'luxon';

import { injectTRPC } from '../../core/trpc-client';
import { EventGeneralForm } from '../../shared/components/forms/event-general-form/event-general-form';
import {
  createEventGeneralFormModel,
  EventGeneralFormModel,
  eventGeneralFormSchema,
} from '../../shared/components/forms/event-general-form/event-general-form.schema';
import {
  RegistrationOptionForm,
} from '../../shared/components/forms/registration-option-form/registration-option-form';
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
  private trpc = injectTRPC();
  protected readonly createEventMutation = injectMutation(() =>
    this.trpc.events.create.mutationOptions(),
  );
  protected readonly faArrowLeft = faArrowLeft;
  protected readonly registrationModes = [
    'fcfs',
    'random',
    'application',
  ] as const;
  protected readonly templateId = input.required<string>();
  protected readonly templateQuery = injectQuery(() =>
    this.trpc.templates.findOne.queryOptions({ id: this.templateId() }),
  );
  private readonly lastStart = signal<DateTime | null>(null);

  private readonly queryClient = inject(QueryClient);
  private readonly router = inject(Router);

  constructor() {
    effect(() => {
      const template = this.templateQuery.data();
      if (template) {
        this.createEventModel.set(
          createEventGeneralFormModel({
            description: template.description,
            icon: template.icon,
            location: template.location,
            registrationOptions: template.registrationOptions.map((option) =>
              createRegistrationOptionFormModel({
                closeRegistrationTime: new Date(),
                description: option.description ?? '',
                isPaid: option.isPaid,
                openRegistrationTime: new Date(),
                organizingRegistration: option.organizingRegistration,
                price: option.price,
                registeredDescription: option.registeredDescription ?? '',
                registrationMode: option.registrationMode,
                spots: option.spots,
                stripeTaxRateId: option.stripeTaxRateId ?? null,
                title: option.title,
              }),
            ),
            title: template.title,
          }),
        );
      }
    });
    effect(() => {
      const template = this.templateQuery.data();
      const eventStart = this.createEventForm.start().value();
      const registrationOptions = this.createEventModel().registrationOptions;
      if (!template || !eventStart || registrationOptions.length === 0) return;
      consola.info(eventStart);
      consola.info(DateTime.isDateTime(eventStart));
      const startDateTime = this.toDateTime(eventStart);
      const previousStart = this.lastStart();
      this.lastStart.set(startDateTime);

      const endField = this.createEventForm.end;
      const endState = endField();
      if (
        previousStart &&
        !endState.dirty() &&
        !endState.touched()
      ) {
        const currentEnd = this.toDateTime(endState.value());
        const durationMs = currentEnd.toMillis() - previousStart.toMillis();
        const nextEnd = startDateTime.plus({ milliseconds: durationMs });
        this.updateIfPristine(endField, nextEnd.toJSDate());
      }

      template.registrationOptions.forEach((option, index) => {
        const optionForm = this.createEventForm.registrationOptions[index];
        if (!optionForm) return;
        const openRegistrationTime = startDateTime
          .minus({ hours: option.openRegistrationOffset })
          .toJSDate();
        const closeRegistrationTime = startDateTime
          .minus({ hours: option.closeRegistrationOffset })
          .toJSDate();

        this.updateIfPristine(
          optionForm.openRegistrationTime,
          openRegistrationTime,
        );
        this.updateIfPristine(
          optionForm.closeRegistrationTime,
          closeRegistrationTime,
        );
      });
    });
  }

  private toDateTime(value: Date | DateTime): DateTime {
    return DateTime.isDateTime(value) ? value : DateTime.fromJSDate(value);
  }

  private updateIfPristine(field: FieldTree<Date>, nextValue: Date): void {
    const state = field();
    if (state.dirty() || state.touched()) return;
    const currentValue = state.value();
    if (currentValue.getTime() === nextValue.getTime()) return;
    state.reset(nextValue);
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
          icon: formValue.icon,
          templateId: this.templateId(),
        },
        {
          onSuccess: async (data) => {
            await this.queryClient.invalidateQueries({
              queryKey: this.trpc.events.eventList.pathKey(),
            });
            this.router.navigate(['/events', data.id]);
          },
        },
      );
    });
  }
}
