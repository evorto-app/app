import { CurrencyPipe } from '@angular/common';
import {
  DEFAULT_CURRENCY_CODE,
  inject,
  LOCALE_ID,
  Pipe,
  PipeTransform,
} from '@angular/core';

/** Formats receipt amounts stored in the database's smallest currency unit. */
@Pipe({
  name: 'receiptAmount',
})
export class ReceiptAmountPipe implements PipeTransform {
  private readonly defaultCurrencyCode = inject(DEFAULT_CURRENCY_CODE);
  private readonly currencyPipe = new CurrencyPipe(
    inject(LOCALE_ID),
    this.defaultCurrencyCode,
  );

  transform(
    amountInMinorUnits: number,
    currencyCode = this.defaultCurrencyCode,
  ): string {
    return (
      this.currencyPipe.transform(
        amountInMinorUnits / 100,
        currencyCode,
        'symbol',
        '1.2-2',
      ) ?? `${(amountInMinorUnits / 100).toFixed(2)} ${currencyCode}`
    );
  }
}
