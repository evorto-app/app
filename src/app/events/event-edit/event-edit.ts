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
import { MatMenuModule } from '@angular/material/menu';
import { Router, RouterLink } from '@angular/router';
import { FaDuotoneIconComponent } from '@fortawesome/angular-fontawesome';
import {
  faArrowLeft,
  faEllipsisVertical,
} from '@fortawesome/duotone-regular-svg-icons';
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
import { RegistrationOptionForm } from '../../shared/components/forms/registration-option-form/registration-option-form';
import { createRegistrationOptionFormModel } from '../../shared/components/forms/registration-option-form/registration-option-form.schema';
import { IfAnyPermissionDirective } from '../../shared/directives/if-any-permission.directive';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FaDuotoneIconComponent,
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
  protected readonly editEventModel = signal<EventGeneralFormModel>(
    createEventGeneralFormModel(),
  );
  protected readonly editEventForm = form(
    this.editEventModel,
    eventGeneralFormSchema,
  );
  private trpc = injectTRPC();
  protected readonly eventQuery = injectQuery(() =>
    this.trpc.events.findOneForEdit.queryOptions({ id: this.eventId() }),
  );
  protected readonly faArrowLeft = faArrowLeft;
  protected readonly faEllipsisVertical = faEllipsisVertical;
  protected readonly registrationModes = [
    'fcfs',
    'random',
    'application',
  ] as const;
  private queryClient = inject(QueryClient);
  private router = inject(Router);
  protected readonly updateEventMutation = injectMutation(() =>
    this.trpc.events.update.mutationOptions({
      onError: (error) => {
        consola.error('Failed to update event:', error);
      },
      onSuccess: async ({ id }) => {
        await this.queryClient.invalidateQueries({
          queryKey: this.trpc.events.eventList.pathKey(),
        });
        return this.router.navigate(['/events', id]);
      },
    }),
  );
  constructor() {
    effect(() => {
      const event = this.eventQuery.data();
      if (event) {
        this.editEventModel.set(
          createEventGeneralFormModel({
            description: event.description,
            end: event.end
              ? DateTime.fromJSDate(new Date(event.end))
              : DateTime.now(),
            icon: event.icon,
            // eslint-disable-next-line unicorn/no-null
            location: event.location ?? null,
            registrationOptions: event.registrationOptions.map((option) =>
              createRegistrationOptionFormModel({
                closeRegistrationTime: option.closeRegistrationTime
                  ? DateTime.fromJSDate(new Date(option.closeRegistrationTime))
                  : DateTime.now(),
                description: option.description ?? '',
                isPaid: option.isPaid,
                openRegistrationTime: option.openRegistrationTime
                  ? DateTime.fromJSDate(new Date(option.openRegistrationTime))
                  : DateTime.now(),
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
            start: event.start
              ? DateTime.fromJSDate(new Date(event.start))
              : DateTime.now(),
            title: event.title,
          }),
        );
      }
    });
  }
  protected async saveEvent(event: Event) {
    event.preventDefault();
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

      this.updateEventMutation.mutate({
        description: formValue.description,
        end: formValue.end.toJSDate(),
        eventId: this.eventId(),
        icon: formValue.icon,
        location: formValue.location,
        start: formValue.start.toJSDate(),
        title: formValue.title,
      });
    });
  }
}
