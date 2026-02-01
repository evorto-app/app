import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { form, submit } from '@angular/forms/signals';
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
      if (template && eventStart) {
        consola.info(eventStart);
        consola.info(DateTime.isDateTime(eventStart));
        const startDateTime = DateTime.fromJSDate(eventStart);
        const updatedOptions = template.registrationOptions.map(
          (option, index) => {
            const openRegistrationTime = startDateTime
              .minus({ hours: option.openRegistrationOffset })
              .toJSDate();
            const closeRegistrationTime = startDateTime
              .minus({ hours: option.closeRegistrationOffset })
              .toJSDate();
            const currentOption =
              this.createEventModel().registrationOptions[index] ??
              createRegistrationOptionFormModel({
                description: option.description ?? '',
                isPaid: option.isPaid,
                organizingRegistration: option.organizingRegistration,
                price: option.price,
                registeredDescription: option.registeredDescription ?? '',
                registrationMode: option.registrationMode,
                spots: option.spots,
                stripeTaxRateId: option.stripeTaxRateId ?? null,
                title: option.title,
              });

            return {
              ...currentOption,
              closeRegistrationTime,
              openRegistrationTime,
            };
          },
        );

        this.createEventModel.update((current) => ({
          ...current,
          registrationOptions: updatedOptions,
        }));
      }
    });
  }

  async onSubmit(event: Event) {
    event.preventDefault();
    await submit(this.createEventForm, async (formState) => {
      const formValue = formState.value();
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
