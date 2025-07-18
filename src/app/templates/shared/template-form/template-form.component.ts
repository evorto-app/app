import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  output,
} from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { PartialDeep } from 'type-fest';

import { injectTRPC } from '../../../core/trpc-client';
import { EditorComponent } from '../../../shared/components/controls/editor/editor.component';
import { IconSelectorFieldComponent } from '../../../shared/components/controls/icon-selector/icon-selector-field/icon-selector-field.component';
import { RoleSelectComponent } from '../../../shared/components/controls/role-select/role-select.component';

export type RegistrationMode = 'application' | 'fcfs' | 'random';

export interface TemplateFormData {
  categoryId: string;
  description: string;
  icon: string;
  organizerRegistration: {
    closeRegistrationOffset: number;
    isPaid: boolean;
    openRegistrationOffset: number;
    price: number;
    registrationMode: RegistrationMode;
    roleIds: string[];
    spots: number;
  };
  participantRegistration: {
    closeRegistrationOffset: number;
    isPaid: boolean;
    openRegistrationOffset: number;
    price: number;
    registrationMode: RegistrationMode;
    roleIds: string[];
    spots: number;
  };
  title: string;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    MatInputModule,
    MatButtonModule,
    MatSelectModule,
    EditorComponent,
    IconSelectorFieldComponent,
    MatSlideToggleModule,
    RoleSelectComponent,
  ],
  selector: 'app-template-form',
  standalone: true,
  templateUrl: './template-form.component.html',
})
export class TemplateFormComponent {
  public readonly initialData = input<PartialDeep<TemplateFormData>>({});

  public readonly isSubmitting = input(false);

  public readonly submitLabel = input('Save template');
  protected formSubmit = output<TemplateFormData>();
  protected readonly registrationModes: RegistrationMode[] = [
    'fcfs',
    'random',
    'application',
  ];

  private trpc = injectTRPC();
  protected readonly templateCategoriesQuery = injectQuery(() =>
    this.trpc.templateCategories.findMany.queryOptions(),
  );

  private formBuilder = inject(NonNullableFormBuilder);

  protected templateForm = this.formBuilder.group({
    categoryId: [''],
    description: [''],
    icon: [''],
    organizerRegistration: this.formBuilder.group({
      closeRegistrationOffset: [1],
      isPaid: [false],
      openRegistrationOffset: [168],
      price: [0],
      registrationMode: this.formBuilder.control<RegistrationMode>('fcfs'),
      roleIds: this.formBuilder.control<string[]>([]),
      spots: [1],
    }),
    participantRegistration: this.formBuilder.group({
      closeRegistrationOffset: [1],
      isPaid: [false],
      openRegistrationOffset: [168],
      price: [0],
      registrationMode: this.formBuilder.control<RegistrationMode>('fcfs'),
      roleIds: this.formBuilder.control<string[]>([]),
      spots: [20],
    }),
    title: [''],
  });

  constructor() {
    effect(() => {
      const data = this.initialData();
      if (data) {
        this.templateForm.patchValue(data, { emitEvent: true });
      }
    });
  }

  onSubmit() {
    if (this.templateForm.invalid) return;
    this.formSubmit.emit(this.templateForm.getRawValue());
  }
}
