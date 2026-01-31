import { CurrencyPipe, TitleCasePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { FieldTree, FormField } from '@angular/forms/signals';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTimepickerModule } from '@angular/material/timepicker';
import { injectQuery } from '@tanstack/angular-query-experimental';

import { injectTRPC } from '../../../../core/trpc-client';
import { EditorComponent } from '../../controls/editor/editor.component';
import { RegistrationOptionFormModel } from './registration-option-form.schema';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CurrencyPipe,
    EditorComponent,
    FormField,
    MatCheckboxModule,
    MatSelectModule,
    MatDatepickerModule,
    MatTimepickerModule,
    MatFormFieldModule,
    MatInputModule,
    TitleCasePipe,
  ],
  selector: 'app-registration-option-form',
  styles: ``,
  templateUrl: './registration-option-form.html',
})
export class RegistrationOptionForm {
  public registrationModes = input.required<readonly string[]>();
  public registrationOptionForm =
    input.required<FieldTree<RegistrationOptionFormModel>>();
  private trpc = injectTRPC();
  protected readonly taxRatesQuery = injectQuery(() =>
    this.trpc.taxRates.listActive.queryOptions(),
  );
}
