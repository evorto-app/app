import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
} from '@angular/core';
import {
  FormArray,
  NonNullableFormBuilder,
  ReactiveFormsModule,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { Router, RouterLink } from '@angular/router';
import { FaDuotoneIconComponent } from '@fortawesome/angular-fontawesome';
import {
  faArrowLeft,
  faEllipsisVertical,
} from '@fortawesome/duotone-regular-svg-icons';
import { injectMutation, injectQuery } from '@tanstack/angular-query-experimental';

import { NotificationService } from '../../core/notification.service';
import { injectTRPC } from '../../core/trpc-client';
import { EventGeneralForm } from '../../shared/components/forms/event-general-form/event-general-form';
import {
  RegistrationOptionForm,
  RegistrationOptionFormGroup,
} from '../../shared/components/forms/registration-option-form/registration-option-form';
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
    ReactiveFormsModule,
    RegistrationOptionForm,
  ],
  selector: 'app-event-edit',
  styles: ``,
  templateUrl: './event-edit.html',
})
export class EventEdit {
  public eventId = input.required<string>();
  
  get registrationOptions() {
    return this.editEventForm.get(
      'registrationOptions',
    ) as (typeof this.editEventForm)['controls']['registrationOptions'];
  }
  
  private fb = inject(NonNullableFormBuilder);
  private router = inject(Router);
  private notifications = inject(NotificationService);
  private trpc = injectTRPC();
  
  protected readonly editEventForm = this.fb.group({
    description: this.fb.control(''),
    end: this.fb.control<Date>(new Date()),
    icon: this.fb.control(''),
    registrationOptions: this.fb.array<RegistrationOptionFormGroup>([]),
    start: this.fb.control<Date>(new Date()),
    title: this.fb.control(''),
  });
  
  protected readonly eventQuery = injectQuery(() =>
    this.trpc.events.findOne.queryOptions({ id: this.eventId() }),
  );
  
  protected readonly updateEventMutation = injectMutation(() =>
    this.trpc.events.update.mutationOptions(),
  );
  
  protected readonly faArrowLeft = faArrowLeft;
  protected readonly faEllipsisVertical = faEllipsisVertical;
  protected readonly registrationModes = [
    'fcfs',
    'random',
    'application',
  ] as const;

  constructor() {
    effect(() => {
      const event = this.eventQuery.data();
      if (event) {
        this.editEventForm.reset({
          description: event.description,
          end: event.end ? new Date(event.end) : new Date(),
          icon: event.icon,
          start: event.start ? new Date(event.start) : new Date(),
          title: event.title,
        });
        
        this.populateRegistrationOptions(event.registrationOptions);
      }
    });
  }

  protected onSubmit() {
    this.saveEvent();
  }

  private populateRegistrationOptions(registrationOptions: any[]) {
    const registrationOptionsFormArray = this.editEventForm.get(
      'registrationOptions',
    ) as FormArray;
    registrationOptionsFormArray.clear();
    
    for (const option of registrationOptions) {
      registrationOptionsFormArray?.push(
        this.fb.group({
          closeRegistrationTime: [option.closeRegistrationTime ? new Date(option.closeRegistrationTime) : null],
          description: [option.description],
          isPaid: [option.isPaid],
          openRegistrationTime: [option.openRegistrationTime ? new Date(option.openRegistrationTime) : null],
          organizingRegistration: [option.organizingRegistration],
          price: [option.price],
          registeredDescription: [option.registeredDescription],
          registrationMode: [option.registrationMode],
          spots: [option.spots],
          title: [option.title],
        }),
      );
    }
  }

  private transformRegistrationOptions(registrationOptions: any[]) {
    return registrationOptions?.map(option => ({
      closeRegistrationTime: option.closeRegistrationTime!,
      description: option.description || null,
      isPaid: option.isPaid!,
      openRegistrationTime: option.openRegistrationTime!,
      organizingRegistration: option.organizingRegistration!,
      price: option.price!,
      registeredDescription: option.registeredDescription || null,
      registrationMode: option.registrationMode! as 'fcfs' | 'random' | 'application',
      spots: option.spots!,
      title: option.title!,
    })) || [];
  }

  private handleFormErrors() {
    if (this.editEventForm.invalid) {
      this.notifications.showError('Please fill in all required fields');
      return false;
    }
    return true;
  }

  private saveEvent() {
    if (!this.handleFormErrors()) {
      return;
    }

    const formValue = this.editEventForm.value;
    const eventId = this.eventId();
    const registrationOptions = this.transformRegistrationOptions(formValue.registrationOptions || []);
    
    this.updateEventMutation.mutate(
      {
        eventId,
        description: formValue.description!,
        end: formValue.end!,
        icon: formValue.icon!,
        registrationOptions,
        start: formValue.start!,
        title: formValue.title!,
      },
      {
        onSuccess: () => {
          this.notifications.showSuccess('Event updated successfully');
          this.router.navigate(['/events', eventId]);
        },
        onError: (error) => {
          this.notifications.showError(
            'Failed to update event: ' + error.message
          );
        },
      }
    );
  }
}
