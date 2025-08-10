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
import { DurationSelectorComponent } from '../../../shared/components/controls/duration-selector/duration-selector.component';
import { EditorComponent } from '../../../shared/components/controls/editor/editor.component';
import { IconSelectorFieldComponent } from '../../../shared/components/controls/icon-selector/icon-selector-field/icon-selector-field.component';
import { LocationSelectorField } from '../../../shared/components/controls/location-selector/location-selector-field/location-selector-field';
import { RoleSelectComponent } from '../../../shared/components/controls/role-select/role-select.component';

export type RegistrationMode = 'application' | 'fcfs' | 'random';

export interface TemplateFormData {
  categoryId: string;
  description: string;
  icon: { iconColor: number; iconName: string };
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
    LocationSelectorField,
    DurationSelectorComponent,
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
    icon: this.formBuilder.control<null | {
      iconColor: number;
      iconName: string;
    }>(null),
    location: [undefined],
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
        this.templateForm.patchValue(
          {
            ...data,
            icon:
              data.icon?.iconColor && data.icon?.iconName
                ? {
                    iconColor: data.icon.iconColor,
                    iconName: data.icon.iconName,
                  }
                : null,
          },
          { emitEvent: true },
        );
      }
    });
  }

  onSubmit() {
    if (this.templateForm.invalid) return;
    const formValue = this.templateForm.getRawValue();
    this.formSubmit.emit({
      ...formValue,
      icon: formValue.icon!,
    });
  }
}
