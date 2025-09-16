import { CurrencyPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { TaxRateInfo, formatInclusiveTaxLabel } from '../../../../shared/price/format-inclusive-tax-label';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CurrencyPipe],
  selector: 'app-price-with-tax',
  template: `
    <span class="price-with-tax">
      <span class="price-amount">{{ formattedAmount() }}</span>
      <span class="tax-label text-sm text-muted-foreground ml-1">
        {{ taxLabel() }}
      </span>
    </span>
  `,
  styles: [`
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
  `]
})
export class PriceWithTaxComponent {
  /**
   * Price amount in cents (smallest currency unit)
   */
  amount = input.required<number>();

  /**
   * Currency code (default: EUR)
   */
  currency = input<string>('EUR');

  /**
   * Tax rate information for formatting the label
   */
  taxRate = input<TaxRateInfo | null | undefined>();

  /**
   * Whether this is a free option (shows "Free" instead of formatted price)
   */
  isFree = input<boolean>(false);

  /**
   * Computed formatted amount
   */
  protected readonly formattedAmount = computed(() => {
    if (this.isFree() || this.amount() <= 0) {
      return 'Free';
    }
    
    const currencyPipe = new CurrencyPipe('en-US');
    return currencyPipe.transform(
      this.amount() / 100, // Convert cents to main currency unit
      this.currency(),
      'symbol',
      '1.2-2'
    ) || '€0.00';
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