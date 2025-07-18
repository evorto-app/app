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
  private notifications = inject(NotificationService);
  private router = inject(Router);
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
  
  protected readonly faArrowLeft = faArrowLeft;
  protected readonly faEllipsisVertical = faEllipsisVertical;
  protected readonly registrationModes = [
    'application',
    'fcfs',
    'random',
  ] as const;
  
  protected readonly updateEventMutation = injectMutation(() =>
    this.trpc.events.update.mutationOptions(),
  );

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

  private handleFormErrors() {
    if (this.editEventForm.invalid) {
      this.notifications.showError('Please fill in all required fields');
      return false;
    }
    return true;
  }

  private populateRegistrationOptions(registrationOptions: unknown[]) {
    const registrationOptionsFormArray = this.editEventForm.get(
      'registrationOptions',
    ) as FormArray;
    registrationOptionsFormArray.clear();
    
    for (const option of registrationOptions) {
      const regOption = option as {
        closeRegistrationTime?: string;
        description: string;
        isPaid: boolean;
        openRegistrationTime?: string;
        organizingRegistration: boolean;
        price: number;
        registeredDescription: string;
        registrationMode: string;
        spots: number;
        title: string;
      };
      
      registrationOptionsFormArray?.push(
        this.fb.group({
          closeRegistrationTime: [regOption.closeRegistrationTime ? new Date(regOption.closeRegistrationTime) : undefined],
          description: [regOption.description],
          isPaid: [regOption.isPaid],
          openRegistrationTime: [regOption.openRegistrationTime ? new Date(regOption.openRegistrationTime) : undefined],
          organizingRegistration: [regOption.organizingRegistration],
          price: [regOption.price],
          registeredDescription: [regOption.registeredDescription],
          registrationMode: [regOption.registrationMode],
          spots: [regOption.spots],
          title: [regOption.title],
        }),
      );
    }
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
        description: formValue.description as string,
        end: formValue.end as Date,
        eventId,
        icon: formValue.icon as string,
        registrationOptions,
        start: formValue.start as Date,
        title: formValue.title as string,
      },
      {
        onError: (error) => {
          this.notifications.showError(
            'Failed to update event: ' + error.message
          );
        },
        onSuccess: () => {
          this.notifications.showSuccess('Event updated successfully');
          this.router.navigate(['/events', eventId]);
        },
      }
    );
  }

  private transformRegistrationOptions(registrationOptions: unknown[]) {
    return registrationOptions?.map(option => {
      const regOption = option as {
        closeRegistrationTime: Date;
        description: string;
        isPaid: boolean;
        openRegistrationTime: Date;
        organizingRegistration: boolean;
        price: number;
        registeredDescription: string;
        registrationMode: 'application' | 'fcfs' | 'random';
        spots: number;
        title: string;
      };
      
      return {
        closeRegistrationTime: regOption.closeRegistrationTime,
        description: regOption.description || undefined,
        isPaid: regOption.isPaid,
        openRegistrationTime: regOption.openRegistrationTime,
        organizingRegistration: regOption.organizingRegistration,
        price: regOption.price,
        registeredDescription: regOption.registeredDescription || undefined,
        registrationMode: regOption.registrationMode,
        spots: regOption.spots,
        title: regOption.title,
      };
    }) || [];
  }
}
