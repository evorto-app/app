import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  FormArray,
  NonNullableFormBuilder,
  ReactiveFormsModule,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatNativeDateModule } from '@angular/material/core';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTimepickerModule } from '@angular/material/timepicker';
import { Router, RouterLink } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { faArrowLeft } from '@fortawesome/duotone-regular-svg-icons';
import {
  injectMutation,
  injectQuery,
} from '@tanstack/angular-query-experimental';
import { DateTime } from 'luxon';

import { injectTRPC } from '../../core/trpc-client';
import { EventGeneralForm } from '../../shared/components/forms/event-general-form/event-general-form';
import {
  RegistrationOptionForm,
  RegistrationOptionFormGroup,
} from '../../shared/components/forms/registration-option-form/registration-option-form';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FontAwesomeModule,
    MatButtonModule,
    MatCheckboxModule,
    MatDatepickerModule,
    MatFormFieldModule,
    MatInputModule,
    MatNativeDateModule,
    MatSelectModule,
    MatTimepickerModule,
    ReactiveFormsModule,
    RouterLink,
    RegistrationOptionForm,
    EventGeneralForm,
  ],
  standalone: true,
  templateUrl: './template-create-event.component.html',
})
export class TemplateCreateEventComponent {
  get registrationOptions() {
    return this.createEventForm.get(
      'registrationOptions',
    ) as (typeof this.createEventForm)['controls']['registrationOptions'];
  }
  private fb = inject(NonNullableFormBuilder);
  protected readonly createEventForm = this.fb.group({
    description: this.fb.control(''),
    end: this.fb.control<Date>(new Date()),
    icon: this.fb.control(''),
    registrationOptions: this.fb.array<RegistrationOptionFormGroup>([]),
    start: this.fb.control<Date>(new Date()),
    title: this.fb.control(''),
  });
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
  private eventStartValue = toSignal(
    this.createEventForm.controls.start.valueChanges,
  );

  private readonly router = inject(Router);

  constructor() {
    effect(() => {
      const template = this.templateQuery.data();
      if (template) {
        // Set basic template info
        this.createEventForm.patchValue({
          description: template.description,
          icon: template.icon,
          title: template.title,
        });

        const registrationOptionsFormArray = this.createEventForm.get(
          'registrationOptions',
        ) as FormArray;
        registrationOptionsFormArray.clear();
        for (const option of template.registrationOptions) {
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
    effect(() => {
      const template = this.templateQuery.data();
      const eventStart = this.eventStartValue();
      if (template && eventStart) {
        console.log(eventStart);
        console.log(DateTime.isDateTime(eventStart));
        const startDateTime = DateTime.fromJSDate(eventStart);
        for (const [index, option] of template.registrationOptions.entries()) {
          const openRegistrationTime = startDateTime
            .minus({ hours: option.openRegistrationOffset })
            .toJSDate();
          const closeRegistrationTime = startDateTime
            .minus({ hours: option.closeRegistrationOffset })
            .toJSDate();

          const registrationOptionsFormArray = this.createEventForm.get(
            'registrationOptions',
          ) as FormArray;
          const registrationOption = registrationOptionsFormArray.at(index);
          registrationOption
            ?.get('openRegistrationTime')
            ?.patchValue(openRegistrationTime);
          registrationOption
            ?.get('closeRegistrationTime')
            ?.patchValue(closeRegistrationTime);
        }
      }
    });
  }

  async onSubmit() {
    if (this.createEventForm.valid) {
      const formValue = this.createEventForm.getRawValue();
      this.createEventMutation.mutate(
        {
          ...formValue,
          templateId: this.templateId(),
        },
        {
          onSuccess: (data) => {
            this.router.navigate(['/events', data.id]);
          },
        },
      );
    }
  }
}
