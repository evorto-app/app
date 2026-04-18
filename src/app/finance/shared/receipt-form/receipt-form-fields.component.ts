import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatNativeDateModule } from '@angular/material/core';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import {
  OTHER_RECEIPT_COUNTRY_CODE,
  OTHER_RECEIPT_COUNTRY_LABEL,
  RECEIPT_COUNTRY_OPTIONS,
} from '@shared/finance/receipt-countries';

import { ReceiptFormGroup } from './receipt-form.model';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatCheckboxModule,
    MatDatepickerModule,
    MatFormFieldModule,
    MatInputModule,
    MatNativeDateModule,
    MatSelectModule,
    ReactiveFormsModule,
  ],
  selector: 'app-receipt-form-fields',
  templateUrl: './receipt-form-fields.component.html',
})
export class ReceiptFormFieldsComponent {
  readonly form = input.required<ReceiptFormGroup>();
  readonly selectableCountries = input.required<readonly string[]>();

  protected countryLabel(countryCode: string): string {
    if (countryCode === OTHER_RECEIPT_COUNTRY_CODE) {
      return OTHER_RECEIPT_COUNTRY_LABEL;
    }

    const option = RECEIPT_COUNTRY_OPTIONS.find(
      (country) => country.code === countryCode,
    );
    return option ? `${option.label} (${option.code})` : countryCode;
  }
}
