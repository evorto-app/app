import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { TaxRateInfo, formatInclusiveTaxLabel } from '../../../../shared/price/format-inclusive-tax-label';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-inclusive-price-label',
  template: `
    <span class="inclusive-tax-label text-sm text-muted-foreground">
      {{ taxLabel() }}
    </span>
  `,
  styles: [`
    .inclusive-tax-label {
      font-weight: 500;
    }
  `]
})
export class InclusivePriceLabelComponent {
  /**
   * Tax rate information for formatting the label
   */
  taxRate = input<TaxRateInfo | null | undefined>();

  /**
   * Computed tax label using the shared formatting utility
   */
  protected readonly taxLabel = computed(() => {
    return formatInclusiveTaxLabel(this.taxRate());
  });
}