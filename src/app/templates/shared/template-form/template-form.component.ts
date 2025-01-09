import { Component, effect, inject, input, output } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { injectQuery } from '@tanstack/angular-query-experimental';

import { QueriesService } from '../../../core/queries.service';
import { EditorComponent } from '../../../shared/components/controls/editor/editor.component';
import { IconSelectorFieldComponent } from '../../../shared/components/controls/icon-selector/icon-selector-field/icon-selector-field.component';

export interface TemplateFormData {
  categoryId: string;
  description: string;
  icon: string;
  title: string;
}

@Component({
  imports: [
    ReactiveFormsModule,
    MatInputModule,
    MatButtonModule,
    MatSelectModule,
    EditorComponent,
    IconSelectorFieldComponent,
  ],
  selector: 'app-template-form',
  standalone: true,
  templateUrl: './template-form.component.html',
})
export class TemplateFormComponent {
  public readonly initialData = input<Partial<TemplateFormData>>({});

  public readonly isSubmitting = input(false);
  public readonly submitLabel = input('Save template');
  protected formSubmit = output<TemplateFormData>();

  private queries = inject(QueriesService);
  protected readonly templateCategoriesQuery = injectQuery(
    this.queries.templateCategories(),
  );

  private formBuilder = inject(NonNullableFormBuilder);

  protected templateForm = this.formBuilder.group({
    categoryId: [''],
    description: [''],
    icon: [''],
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
