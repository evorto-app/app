import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { formatInclusiveTaxLabel, TaxRateInfo } from '../../../../shared/price/format-inclusive-tax-label';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-inclusive-price-label',
  styles: [`
    .inclusive-tax-label {
      font-weight: 500;
    }
  `],
  template: `
    <span class="inclusive-tax-label text-sm text-muted-foreground">
      {{ taxLabel() }}
    </span>
  `
})
export class InclusivePriceLabelComponent {
  /**
   * Tax rate information for formatting the label
   */
  taxRate = input<null | TaxRateInfo | undefined>();

  /**
   * Computed tax label using the shared formatting utility
   */
  protected readonly taxLabel = computed(() => {
    return formatInclusiveTaxLabel(this.taxRate());
  });
}