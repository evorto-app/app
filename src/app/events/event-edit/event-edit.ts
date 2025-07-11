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
import { MatButtonModule, MatIconButton } from '@angular/material/button';
import { MatMenu, MatMenuModule } from '@angular/material/menu';
import { RouterLink } from '@angular/router';
import { FaDuotoneIconComponent } from '@fortawesome/angular-fontawesome';
import {
  faArrowLeft,
  faEllipsisVertical,
} from '@fortawesome/duotone-regular-svg-icons';
import { injectQuery } from '@tanstack/angular-query-experimental';

import { QueriesService } from '../../core/queries.service';
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
  protected readonly editEventForm = this.fb.group({
    description: this.fb.control(''),
    end: this.fb.control<Date>(new Date()),
    icon: this.fb.control(''),
    registrationOptions: this.fb.array<RegistrationOptionFormGroup>([]),
    start: this.fb.control<Date>(new Date()),
    title: this.fb.control(''),
  });
  private queries = inject(QueriesService);
  protected readonly eventQuery = injectQuery(this.queries.event(this.eventId));
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
        const registrationOptionsFormArray = this.editEventForm.get(
          'registrationOptions',
        ) as FormArray;
        registrationOptionsFormArray.clear();
        for (const option of event.registrationOptions) {
          registrationOptionsFormArray?.push(
            this.fb.group({
              closeRegistrationTime: [],
              description: [option.description],
              isPaid: [option.isPaid],
              openRegistrationTime: [],
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
    });
  }
  protected saveEvent() {}
}
