import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  linkedSignal,
  output,
} from '@angular/core';
import { FormField, form, submit } from '@angular/forms/signals';
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
import {
  mergeTemplateFormOverrides,
  RegistrationMode,
  TemplateFormData,
  TemplateFormOverrides,
  TemplateFormSubmitData,
  templateFormSchema,
} from './template-form.schema';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormField,
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
  public readonly initialData = input<TemplateFormOverrides>({});

  public readonly isSubmitting = input(false);

  public readonly submitLabel = input('Save template');
  protected formSubmit = output<TemplateFormSubmitData>();
  protected readonly registrationModes: RegistrationMode[] = [
    'fcfs',
    'random',
    'application',
  ];

  private trpc = injectTRPC();
  protected readonly taxRatesQuery = injectQuery(() =>
    this.trpc.taxRates.listActive.queryOptions(),
  );
  protected readonly templateCategoriesQuery = injectQuery(() =>
    this.trpc.templateCategories.findMany.queryOptions(),
  );

  private readonly templateModel = linkedSignal<
    TemplateFormOverrides,
    TemplateFormData
  >({
    source: () => this.initialData(),
    computation: (data, previous) =>
      mergeTemplateFormOverrides(data, previous?.value),
  });

  protected readonly templateForm = form(
    this.templateModel,
    templateFormSchema,
  );

  async onSubmit(event: Event) {
    event.preventDefault();
    await submit(this.templateForm, async (formState) => {
      const formValue = formState.value();
      if (!formValue.icon) {
        return;
      }
      this.formSubmit.emit({
        ...formValue,
        icon: formValue.icon,
      });
    });
  }
}
