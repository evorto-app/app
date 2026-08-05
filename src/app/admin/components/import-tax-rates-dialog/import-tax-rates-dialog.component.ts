import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatChipsModule } from '@angular/material/chips';
import {
  MAT_DIALOG_DATA,
  MatDialogModule,
  MatDialogRef,
} from '@angular/material/dialog';
import {
  injectMutation,
  injectQuery,
} from '@tanstack/angular-query-experimental';

import { AppRpc } from '../../../core/effect-rpc-angular-client';
import { getErrorMessage } from '../../../core/error-message';
import { taxRateRegionLabel } from '../../../core/geography-labels';

export const stripeTaxRatesDashboardLink = {
  href: 'https://dashboard.stripe.com/tax-rates',
  label: 'Open tax rate settings',
};

export interface ImportTaxRatesDialogData {
  readonly importedTaxRateIds: readonly string[];
}

export const taxRateCatalogErrorMessage = (error: unknown): string =>
  getErrorMessage(error, 'Tax rates could not be loaded. Try again.', [
    'RpcBadRequestError',
  ]);

export const taxRateImportErrorMessage = (error: unknown): string =>
  getErrorMessage(
    error,
    'The tax rates could not be added. Nothing changed. Try again.',
    ['RpcBadRequestError'],
  );

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatDialogModule,
    MatButtonModule,
    MatCheckboxModule,
    MatChipsModule,
  ],
  selector: 'app-import-tax-rates-dialog',
  templateUrl: './import-tax-rates-dialog.component.html',
})
export class ImportTaxRatesDialogComponent {
  private readonly rpc = AppRpc.injectClient();
  protected readonly importMutation = injectMutation(() =>
    this.rpc.admin.tenant.importStripeTaxRates.mutationOptions(),
  );
  protected readonly ratesQuery = injectQuery(() =>
    this.rpc.admin.tenant.listStripeTaxRates.queryOptions(),
  );

  protected readonly selected = signal<string[]>([]);

  protected readonly canImport = computed(
    () =>
      !taxRateImportActionDisabled({
        mutationPending: this.importMutation.isPending(),
        ratesReady: this.ratesQuery.isSuccess(),
        selectedCount: this.selected().length,
      }),
  );
  protected readonly dashboardLink = stripeTaxRatesDashboardLink;
  private readonly data = inject<ImportTaxRatesDialogData>(MAT_DIALOG_DATA);
  protected readonly importedIds = new Set(this.data.importedTaxRateIds);

  protected readonly taxRateRegionLabel = taxRateRegionLabel;
  private readonly dialogRef = inject(
    MatDialogRef<ImportTaxRatesDialogComponent>,
  );

  protected readonly importErrorMessage = () =>
    taxRateImportErrorMessage(this.importMutation.error());

  protected importSelected() {
    const ids = this.selected();
    if (
      taxRateImportActionDisabled({
        mutationPending: this.importMutation.isPending(),
        ratesReady: this.ratesQuery.isSuccess(),
        selectedCount: ids.length,
      })
    )
      return;
    this.importMutation.mutate(
      { ids },
      {
        onSuccess: () => {
          this.dialogRef.close(true);
        },
      },
    );
  }

  protected readonly loadErrorMessage = () =>
    taxRateCatalogErrorMessage(this.ratesQuery.error());

  protected toggle(id: string, checked: boolean) {
    const current = this.selected();
    if (checked) {
      if (!current.includes(id)) this.selected.set([...current, id]);
    } else {
      this.selected.set(current.filter((x) => x !== id));
    }
  }
}

export function taxRateImportActionDisabled(input: {
  mutationPending: boolean;
  ratesReady: boolean;
  selectedCount: number;
}) {
  return (
    input.mutationPending || !input.ratesReady || input.selectedCount === 0
  );
}
