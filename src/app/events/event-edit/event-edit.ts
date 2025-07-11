import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
} from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { RouterLink } from '@angular/router';
import { FaDuotoneIconComponent } from '@fortawesome/angular-fontawesome';
import {
  faArrowLeft,
  faEllipsisVertical,
} from '@fortawesome/duotone-regular-svg-icons';
import { injectMutation, injectQuery } from '@tanstack/angular-query-experimental';

import { EventFormBase } from '../../shared/components/forms/event-form-base/event-form-base';
import { EventGeneralForm } from '../../shared/components/forms/event-general-form/event-general-form';
import { RegistrationOptionForm } from '../../shared/components/forms/registration-option-form/registration-option-form';
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
export class EventEdit extends EventFormBase {
  public eventId = input.required<string>();
  
  // Use the base class form with a more appropriate name
  protected readonly editEventForm = this.eventForm;
  
  protected readonly eventQuery = injectQuery(this.queries.event(this.eventId));
  protected readonly updateEventMutation = injectMutation(this.queries.updateEvent());
  protected readonly faArrowLeft = faArrowLeft;
  protected readonly faEllipsisVertical = faEllipsisVertical;

  constructor() {
    super();
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
