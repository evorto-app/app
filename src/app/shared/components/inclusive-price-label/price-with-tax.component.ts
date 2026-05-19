import { CurrencyPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DEFAULT_CURRENCY_CODE,
  inject,
  input,
  LOCALE_ID,
} from '@angular/core';

import {
  formatInclusiveTaxLabel,
  TaxRateInfo,
} from '../../../../shared/price/format-inclusive-tax-label';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-price-with-tax',
  styles: [
    `
      .price-with-tax {
        display: inline-flex;
        align-items: baseline;
        gap: 0.25rem;
      }

      .price-amount {
        font-weight: 600;
      }

      .tax-label {
        font-weight: 500;
      }
    `,
  ],
  template: `
    <span class="price-with-tax">
      <span class="price-amount">{{ formattedAmount() }}</span>
      <span class="tax-label text-sm text-muted-foreground ml-1">
        {{ taxLabel() }}
      </span>
    </span>
  `,
})
export class PriceWithTaxComponent {
  /**
   * Price amount in cents (smallest currency unit)
   */
  amount = input.required<number>();
  /**
   * Currency code. Defaults to the tenant-level DEFAULT_CURRENCY_CODE.
   */
  currency = input<string | undefined>();

  /**
   * Whether this is a free option (shows "Free" instead of formatted price)
   */
  isFree = input<boolean>(false);

  /**
   * Tax rate information for formatting the label
   */
  taxRate = input<null | TaxRateInfo | undefined>();

  private readonly defaultCurrencyCode = inject(DEFAULT_CURRENCY_CODE);

  private readonly localeId = inject(LOCALE_ID);

  /**
   * Computed formatted amount
   */
  protected readonly formattedAmount = computed(() => {
    if (this.isFree() || this.amount() <= 0) {
      return 'Free';
    }

    const currencyPipe = new CurrencyPipe(this.localeId);
    return (
      currencyPipe.transform(
        this.amount() / 100, // Convert cents to main currency unit
        this.currency() ?? this.defaultCurrencyCode,
        'symbol',
        '1.2-2',
      ) || `${this.defaultCurrencyCode}0.00`
    );
  });

  /**
   * Computed tax label - only show for paid options
   */
  protected readonly taxLabel = computed(() => {
    if (this.isFree() || this.amount() <= 0) {
      return '';
    }

    return formatInclusiveTaxLabel(this.taxRate());
  });
}
