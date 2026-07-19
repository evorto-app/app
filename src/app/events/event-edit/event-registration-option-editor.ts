import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { FieldTree, FormField } from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTimepickerModule } from '@angular/material/timepicker';
import {
  registrationModeLabel,
  writableRegistrationModes,
} from '@shared/registration-modes';
import { injectQuery } from '@tanstack/angular-query-experimental';

import type { EventGraphRegistrationOptionFormModel } from './event-graph-form.model';

import { AppRpc } from '../../core/effect-rpc-angular-client';
import { CurrencyAmountInputComponent } from '../../shared/components/controls/currency-amount-input/currency-amount-input.component';
import { EditorComponent } from '../../shared/components/controls/editor/editor.component';
import { RoleSelectComponent } from '../../shared/components/controls/role-select/role-select.component';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CurrencyAmountInputComponent,
    EditorComponent,
    FormField,
    MatButtonModule,
    MatCheckboxModule,
    MatDatepickerModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatTimepickerModule,
    RoleSelectComponent,
  ],
  selector: 'app-event-registration-option-editor',
  templateUrl: './event-registration-option-editor.html',
})
export class EventRegistrationOptionEditor {
  readonly currencyCode = input.required<string>();
  readonly esnEnabled = input.required<boolean>();
  readonly optionForm =
    input.required<FieldTree<EventGraphRegistrationOptionFormModel>>();
  readonly removable = input(false);
  readonly removeRequested = output();
  readonly simpleMode = input(false);

  protected readonly registrationModeLabel = registrationModeLabel;
  protected readonly registrationModes = writableRegistrationModes;
  private readonly rpc = AppRpc.injectClient();
  protected readonly taxRatesQuery = injectQuery(() =>
    this.rpc.taxRates.listActive.queryOptions(),
  );
}
