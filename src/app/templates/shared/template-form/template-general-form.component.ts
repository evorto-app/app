import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { FieldTree, FormField } from '@angular/forms/signals';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { injectQuery } from '@tanstack/angular-query-experimental';

import { injectTRPC } from '../../../core/trpc-client';
import { EditorComponent } from '../../../shared/components/controls/editor/editor.component';
import { IconSelectorFieldComponent } from '../../../shared/components/controls/icon-selector/icon-selector-field/icon-selector-field.component';
import { LocationSelectorField } from '../../../shared/components/controls/location-selector/location-selector-field/location-selector-field';
import { TemplateFormData } from './template-form.schema';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    EditorComponent,
    FormField,
    IconSelectorFieldComponent,
    LocationSelectorField,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
  ],
  selector: 'app-template-general-form',
  templateUrl: './template-general-form.component.html',
})
export class TemplateGeneralFormComponent {
  public readonly generalForm = input.required<FieldTree<TemplateFormData>>();

  private trpc = injectTRPC();
  protected readonly templateCategoriesQuery = injectQuery(() =>
    this.trpc.templateCategories.findMany.queryOptions(),
  );
}
