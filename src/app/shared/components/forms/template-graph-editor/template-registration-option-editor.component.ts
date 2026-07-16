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
import { faTrashCan } from '@fortawesome/duotone-regular-svg-icons';
import {
  registrationModeLabel,
  writableRegistrationModes,
} from '@shared/registration-modes';

import { CurrencyAmountInputComponent } from '../../controls/currency-amount-input/currency-amount-input.component';
import { DurationSelectorComponent } from '../../controls/duration-selector/duration-selector.component';
import { EditorComponent } from '../../controls/editor/editor.component';
import { RoleSelectComponent } from '../../controls/role-select/role-select.component';
import { TemplateGraphRegistrationOptionFormModel } from './template-graph-form.model';

export type TemplateTaxRateLoadState = 'error' | 'loading' | 'ready';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: '@container block' },
  imports: [
    CurrencyAmountInputComponent,
    DurationSelectorComponent,
    EditorComponent,
    FontAwesomeModule,
    FormField,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    RoleSelectComponent,
  ],
  selector: 'app-template-registration-option-editor',
  templateUrl: './template-registration-option-editor.component.html',
})
export class TemplateRegistrationOptionEditorComponent {
  readonly currencyCode = input.required<string>();
  readonly esnEnabled = input(false);
  readonly optionForm =
    input.required<FieldTree<TemplateGraphRegistrationOptionFormModel>>();
  readonly referenceCount = input(0);
  readonly remove = output();
  readonly simpleMode = input.required<boolean>();
  readonly taxRates = input<readonly TaxRatesListActiveRecord[]>([]);
  readonly taxRateState = input<TemplateTaxRateLoadState>('loading');

  protected readonly faTrashCan = faTrashCan;
  protected readonly registrationModeLabel = registrationModeLabel;
  protected readonly registrationModes = writableRegistrationModes;
}
