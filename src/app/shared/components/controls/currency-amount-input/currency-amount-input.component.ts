import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  model,
  output,
  signal,
} from '@angular/core';
import {
  type FormValueControl,
  transformedValue,
  ValidationError,
} from '@angular/forms/signals';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';

export const currencyAmountFractionError = {
  kind: 'currencyFraction',
  message: 'Enter an amount with no more than two decimal places.',
} as const;

export const currencyAmountRequiredError = {
  kind: 'currencyRequired',
  message: 'Enter an amount.',
} as const;

export type CurrencyAmountParseResult =
  | {
      readonly error:
        typeof currencyAmountFractionError | typeof currencyAmountRequiredError;
    }
  | { readonly value: '' | number };

export const majorCurrencyInputToMinorUnits = (
  rawValue: string,
  allowEmpty: boolean,
): CurrencyAmountParseResult => {
  const normalized = rawValue.trim();
  if (normalized === '') {
    return allowEmpty ? { value: '' } : { error: currencyAmountRequiredError };
  }

  const majorUnits = Number(normalized);
  if (!Number.isFinite(majorUnits)) {
    return { error: currencyAmountRequiredError };
  }

  const scaled = majorUnits * 100;
  const minorUnits = Math.round(scaled);
  return Math.abs(scaled - minorUnits) <= 1e-8
    ? { value: minorUnits }
    : { error: currencyAmountFractionError };
};

export const minorUnitsToMajorCurrencyInput = (
  minorUnits: '' | null | number,
): string =>
  minorUnits === '' || minorUnits === null ? '' : String(minorUnits / 100);

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  imports: [MatFormFieldModule, MatInputModule],
  selector: 'app-currency-amount-input',
  templateUrl: './currency-amount-input.component.html',
})
export class CurrencyAmountInputComponent implements FormValueControl<
  '' | number
> {
  readonly allowEmpty = input(false);
  readonly currencyCode = input.required<string>();
  readonly disabled = input(false);
  readonly errors = input<readonly ValidationError.WithOptionalFieldTree[]>([]);
  readonly hidden = input(false);
  readonly hint = input('');
  readonly label = input.required<string>();
  readonly minimumMinorUnits = input(0);
  readonly readonly = input(false);
  readonly required = input(false);
  readonly touch = output();
  readonly touched = input(false);
  readonly value = model.required<'' | number>();

  protected readonly majorUnitValue = transformedValue(this.value, {
    format: minorUnitsToMajorCurrencyInput,
    parse: (rawValue) =>
      majorCurrencyInputToMinorUnits(rawValue, this.allowEmpty()),
  });
  protected readonly firstErrorMessage = computed(
    () =>
      this.majorUnitValue.parseErrors()[0]?.message ??
      this.errors()[0]?.message ??
      null,
  );
  protected readonly formattedLabel = computed(() => {
    const currencyCode = this.currencyCode();
    return currencyCode ? `${this.label()} (${currencyCode})` : this.label();
  });
  protected readonly minimumMajorUnits = computed(
    () => this.minimumMinorUnits() / 100,
  );
  private readonly locallyTouched = signal(false);
  protected readonly showError = computed(
    () =>
      (this.touched() || this.locallyTouched()) &&
      this.firstErrorMessage() !== null,
  );

  protected markTouched(): void {
    this.locallyTouched.set(true);
    this.touch.emit();
  }

  protected updateValue(event: Event): void {
    if (event.target instanceof HTMLInputElement) {
      this.majorUnitValue.set(event.target.value);
    }
  }
}
