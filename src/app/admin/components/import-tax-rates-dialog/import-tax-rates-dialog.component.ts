import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { injectMutation, injectQuery } from '@tanstack/angular-query-experimental';

import { injectTRPC } from '../../../core/trpc-client';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatDialogModule, MatButtonModule, MatCheckboxModule, MatChipsModule],
  selector: 'app-import-tax-rates-dialog',
  templateUrl: './import-tax-rates-dialog.component.html',
})
export class ImportTaxRatesDialogComponent {
  protected readonly selected = signal<string[]>([]);
  protected readonly canImport = computed(() => this.selected().length > 0);

  private readonly trpc = injectTRPC();

  protected readonly importedQuery = injectQuery(() =>
    this.trpc.admin.tenant.listImportedTaxRates.queryOptions(),
  );
  protected readonly importedIds = computed(
    () => new Set((this.importedQuery.data() ?? []).map((r) => r.stripeTaxRateId)),
  );

  protected readonly ratesQuery = injectQuery(() =>
    this.trpc.admin.tenant.listStripeTaxRates.queryOptions(),
  );
  private readonly dialogRef = inject(MatDialogRef<ImportTaxRatesDialogComponent>);

  private readonly importMutation = injectMutation(() =>
    this.trpc.admin.tenant.importStripeTaxRates.mutationOptions({
      onSuccess: () => {
        this.dialogRef.close(true);
      },
    }),
  );

  protected importSelected() {
    const ids = this.selected();
    if (ids.length === 0) return;
    this.importMutation.mutate({ ids });
  }

  protected toggle(id: string, checked: boolean) {
    const current = this.selected();
    if (checked) {
      if (!current.includes(id)) this.selected.set([...current, id]);
    } else {
      this.selected.set(current.filter((x) => x !== id));
    }
  }
}
