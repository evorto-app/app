import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { FieldTree, FormField } from '@angular/forms/signals';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTimepickerModule } from '@angular/material/timepicker';
import {
  type RegistrationMode,
  registrationModeLabel,
} from '@shared/registration-modes';
import { injectQuery } from '@tanstack/angular-query-experimental';

import { ConfigService } from '../../../../core/config.service';
import { AppRpc } from '../../../../core/effect-rpc-angular-client';
import { tenantCurrencyCode } from '../../../../core/tenant-runtime';
import { CurrencyAmountInputComponent } from '../../controls/currency-amount-input/currency-amount-input.component';
import { EditorComponent } from '../../controls/editor/editor.component';
import { RoleSelectComponent } from '../../controls/role-select/role-select.component';
import { RegistrationOptionFormModel } from './registration-option-form.schema';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CurrencyAmountInputComponent,
    EditorComponent,
    FormField,
    MatCheckboxModule,
    MatSelectModule,
    MatDatepickerModule,
    MatTimepickerModule,
    MatFormFieldModule,
    MatInputModule,
    RoleSelectComponent,
  ],
  selector: 'app-registration-option-form',
  styles: ``,
  templateUrl: './registration-option-form.html',
})
export class RegistrationOptionForm {
  public esnEnabled = input.required<boolean>();
  public registrationModes = input.required<readonly RegistrationMode[]>();
  public registrationOptionForm =
    input.required<FieldTree<RegistrationOptionFormModel>>();
  protected readonly registrationModeLabel = registrationModeLabel;
  private readonly rpc = AppRpc.injectClient();
  protected readonly taxRatesQuery = injectQuery(() =>
    this.rpc.taxRates.listActive.queryOptions(),
  );
  private readonly config = inject(ConfigService);
  protected readonly tenantCurrency = computed(() =>
    tenantCurrencyCode(this.config),
  );
}
