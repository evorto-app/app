import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { FieldTree, FormField } from '@angular/forms/signals';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { injectQuery } from '@tanstack/angular-query-experimental';

import { type TemplateCategoryRecord } from '../../../../shared/rpc-contracts/app-rpcs';
import { AppRpc } from '../../../core/effect-rpc-angular-client';
import { EditorComponent } from '../../../shared/components/controls/editor/editor.component';
import { IconSelectorFieldComponent } from '../../../shared/components/controls/icon-selector/icon-selector-field/icon-selector-field.component';
import { LocationSelectorField } from '../../../shared/components/controls/location-selector/location-selector-field/location-selector-field';
import { TemplateFormData } from './template-form.utilities';

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

  private readonly rpc = AppRpc.injectClient();
  protected readonly templateCategoriesQuery = injectQuery(() =>
    this.rpc.templateCategories.findMany.queryOptions(),
  );
  protected readonly templateCategories = computed<
    readonly TemplateCategoryRecord[]
  >(() => this.templateCategoriesQuery.data() ?? []);
}
