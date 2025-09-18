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
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { Subscription } from 'rxjs';

import { injectTRPC } from '../../../../core/trpc-client';
import { EditorComponent } from '../../controls/editor/editor.component';

export type RegistrationOptionFormGroup = FormGroup<{
  closeRegistrationTime: FormControl<Date>;
  description: FormControl<string>;
  discounts: FormControl<Array<{ discountType: 'esnCard'; discountedPrice: number }>>;
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
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
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
  protected readonly discountProvidersQuery = injectQuery(() =>
    this.trpc.discounts.getTenantProviders.queryOptions(),
  );

  private sub?: Subscription;

  get enabledProviders() {
    return this.discountProvidersQuery.data()?.filter(p => p.enabled === true) ?? [];
  }

  get currentDiscounts() {
    return this.registrationOptionForm().controls.discounts.value ?? [];
  }

  addDiscountForProvider(providerType: 'esnCard') {
    const currentDiscounts = this.currentDiscounts;
    const basePrice = this.registrationOptionForm().controls.price.value ?? 0;

    // Check if discount already exists for this provider
    if (currentDiscounts.some(d => d.discountType === providerType)) {
      return;
    }

    const newDiscount = {
      discountType: providerType,
      discountedPrice: Math.max(0, basePrice - Math.floor(basePrice * 0.1)) // Default 10% discount
    };

    this.registrationOptionForm().controls.discounts.setValue([
      ...currentDiscounts,
      newDiscount
    ]);
  }

  removeDiscountForProvider(providerType: 'esnCard') {
    const currentDiscounts = this.currentDiscounts;
    this.registrationOptionForm().controls.discounts.setValue(
      currentDiscounts.filter(d => d.discountType !== providerType)
    );
  }

  updateDiscountPrice(providerType: 'esnCard', price: number) {
    const currentDiscounts = this.currentDiscounts;
    const basePrice = this.registrationOptionForm().controls.price.value ?? 0;

    // Validate: discounted price must be <= base price
    const validatedPrice = Math.min(Math.max(0, price), basePrice);

    this.registrationOptionForm().controls.discounts.setValue(
      currentDiscounts.map(d =>
        d.discountType === providerType
          ? { ...d, discountedPrice: validatedPrice }
          : d
      )
    );
  }

  getDiscountForProvider(providerType: 'esnCard') {
    return this.currentDiscounts.find(d => d.discountType === providerType);
  }

  getSavingsAmount(providerType: 'esnCard'): number {
    const discount = this.getDiscountForProvider(providerType);
    const basePrice = this.registrationOptionForm().controls.price.value ?? 0;
    return discount ? basePrice - discount.discountedPrice : 0;
  }

  getSavingsPercentage(providerType: 'esnCard'): number {
    const basePrice = this.registrationOptionForm().controls.price.value ?? 0;
    if (basePrice === 0) return 0;
    const savings = this.getSavingsAmount(providerType);
    return Math.round((savings / basePrice) * 100);
  }

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
