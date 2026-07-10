import type { TaxRatesListActiveRecord } from '@shared/rpc-contracts/app-rpcs/tax-rates.rpcs';

import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { FieldTree, FormField } from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { faPlus, faTrashCan } from '@fortawesome/duotone-regular-svg-icons';

import { TemplateGraphAddonFormModel } from './template-graph-form.model';
import { TemplateTaxRateLoadState } from './template-registration-option-editor.component';

export interface TemplateGraphOptionChoice {
  key: string;
  title: string;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: '@container block' },
  imports: [
    FontAwesomeModule,
    FormField,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
  ],
  selector: 'app-template-addon-editor',
  templateUrl: './template-addon-editor.component.html',
})
export class TemplateAddonEditorComponent {
  readonly addMapping = output();
  readonly addOnForm = input.required<FieldTree<TemplateGraphAddonFormModel>>();
  readonly optionChoices =
    input.required<readonly TemplateGraphOptionChoice[]>();
  readonly remove = output();
  readonly removeMapping = output<number>();
  readonly taxRates = input<readonly TaxRatesListActiveRecord[]>([]);
  readonly taxRateState = input<TemplateTaxRateLoadState>('loading');

  protected readonly faPlus = faPlus;
  protected readonly faTrashCan = faTrashCan;
}
