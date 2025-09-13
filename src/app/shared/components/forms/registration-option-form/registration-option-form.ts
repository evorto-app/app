import { CurrencyPipe, TitleCasePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, input, OnDestroy, OnInit } from '@angular/core';
import {
  AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTimepickerModule } from '@angular/material/timepicker';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { Subscription } from 'rxjs';

import { injectTRPC } from '../../../../core/trpc-client';
import { EditorComponent } from '../../controls/editor/editor.component';

export type RegistrationOptionFormGroup = FormGroup<{
  closeRegistrationTime: FormControl<Date>;
  description: FormControl<string>;
  isPaid: FormControl<boolean>;
  openRegistrationTime: FormControl<Date>;
  organizingRegistration: FormControl<boolean>;
  price: FormControl<number>;
  registeredDescription: FormControl<string>;
  registrationMode: FormControl<'application' | 'fcfs' | 'random'>;
  spots: FormControl<number>;
  stripeTaxRateId: FormControl<null | string>;
  title: FormControl<string>;
}>;

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CurrencyPipe,
    EditorComponent,
    MatCheckboxModule,
    MatSelectModule,
    MatDatepickerModule,
    MatTimepickerModule,
    MatFormFieldModule,
    MatInputModule,
    ReactiveFormsModule,
    TitleCasePipe,
  ],
  selector: 'app-registration-option-form',
  styles: ``,
  templateUrl: './registration-option-form.html',
})
export class RegistrationOptionForm implements OnDestroy, OnInit {
  public registrationModes = input.required<readonly string[]>();
  public registrationOptionForm = input.required<RegistrationOptionFormGroup>();
  private trpc = injectTRPC();
  protected readonly taxRatesQuery = injectQuery(() =>
    this.trpc.taxRates.listActive.queryOptions(),
  );

  private sub?: Subscription;

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  ngOnInit(): void {
    const group = this.registrationOptionForm();
    const isPaid = group.controls.isPaid;
    const tax = group.controls.stripeTaxRateId as AbstractControl<null | string>;

    // Always require the tax rate when enabled
    tax.addValidators([Validators.required]);
    const apply = (paid: boolean) => {
      if (paid) {
        tax.enable({ emitEvent: false });
      } else {
        tax.disable({ emitEvent: false });
      }
    };

    apply(!!isPaid.value);
    this.sub = isPaid.valueChanges.subscribe((v) => apply(!!v));
  }
}
