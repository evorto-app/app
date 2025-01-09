import { CurrencyPipe, TitleCasePipe } from '@angular/common';
import { Component, effect, inject, input } from '@angular/core';
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
import { Router } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { faArrowLeft } from '@fortawesome/duotone-regular-svg-icons';
import {
  injectMutation,
  injectQuery,
} from '@tanstack/angular-query-experimental';

import { QueriesService } from '../../core/queries.service';
import { EditorComponent } from '../../shared/components/controls/editor/editor.component';
import { IconSelectorFieldComponent } from '../../shared/components/controls/icon-selector/icon-selector-field/icon-selector-field.component';

@Component({
  imports: [
    CurrencyPipe,
    EditorComponent,
    FontAwesomeModule,
    IconSelectorFieldComponent,
    MatButtonModule,
    MatCheckboxModule,
    MatDatepickerModule,
    MatFormFieldModule,
    MatInputModule,
    MatNativeDateModule,
    MatSelectModule,
    ReactiveFormsModule,
    TitleCasePipe,
  ],
  standalone: true,
  templateUrl: './template-create-event.component.html',
})
export class TemplateCreateEventComponent {
  get registrationOptions() {
    return this.createEventForm.get('registrationOptions') as FormArray;
  }
  private fb = inject(NonNullableFormBuilder);

  protected readonly createEventForm = this.fb.group({
    description: this.fb.control(''),
    icon: this.fb.control(''),
    registrationOptions: this.fb.array<{
      closeRegistrationOffset: number;
      description: string;
      isPaid: boolean;
      openRegistrationOffset: number;
      organizingRegistration: boolean;
      price: number;
      registeredDescription: string;
      registrationMode: 'application' | 'fcfs' | 'random';
      spots: number;
      templateRegistrationOptionId: number;
      title: string;
    }>([]),
    startTime: this.fb.control<Date>(new Date()),
    title: this.fb.control(''),
  });
  private queries = inject(QueriesService);
  protected readonly createEventMutation = injectMutation(
    this.queries.createEvent(),
  );
  protected readonly faArrowLeft = faArrowLeft;

  protected readonly registrationModes = [
    'fcfs',
    'random',
    'application',
  ] as const;

  protected readonly templateId = input.required<string>();

  protected readonly templateQuery = injectQuery(
    this.queries.template(this.templateId),
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
              closeRegistrationOffset: [option.closeRegistrationOffset],
              description: [option.description ?? ''],
              isPaid: [option.isPaid],
              openRegistrationOffset: [option.openRegistrationOffset],
              organizingRegistration: [false],
              price: [option.price],
              registeredDescription: [option.registeredDescription ?? ''],
              registrationMode: [option.registrationMode],
              spots: [option.spots],
              templateRegistrationOptionId: [option.id],
              title: [option.title],
            }),
          );
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
