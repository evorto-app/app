import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { FieldTree, FormField } from '@angular/forms/signals';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { EffectRpcQueryClient } from '@heddendorp/effect-angular-query';
import { injectQuery } from '@tanstack/angular-query-experimental';

import {
  AppRpcs,
  type TemplateCategoryRecord,
} from '../../../../shared/rpc-contracts/app-rpcs';
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

  private readonly rpcQueryClient = inject(EffectRpcQueryClient);
  private readonly rpcHelpers = this.rpcQueryClient.helpersFor(AppRpcs);
  protected readonly templateCategoriesQuery = injectQuery(() =>
    this.rpcHelpers.templateCategories.findMany.queryOptions(),
  );
  protected readonly templateCategories = computed<
    readonly TemplateCategoryRecord[]
  >(() => this.templateCategoriesQuery.data() ?? []);
}
