import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import {
  injectMutation,
  injectQuery,
} from '@tanstack/angular-query-experimental';

import { injectTRPC } from '../../core/trpc-client';
import { ImportTaxRatesDialogComponent } from '../components/import-tax-rates-dialog/import-tax-rates-dialog.component';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatCardModule,
    MatChipsModule,
    MatIconModule,
    MatTableModule,
  ],
  selector: 'app-tax-rates-settings',
  styles: [``],
  template: `
    <!-- Header with navigation -->
    <div class="mb-4 flex flex-row items-center gap-2">
      <a routerLink="/admin" mat-icon-button class="lg:hidden! block">
        <mat-icon>arrow_back</mat-icon>
      </a>
      <h1 class="title-large">Tax Rates</h1>
    </div>

    <!-- FAB for primary action -->
    <button
      mat-fab
      extended
      class="fab-fixed"
      (click)="openImportDialog()"
      [disabled]="importedQuery.isLoading()"
    >
      <mat-icon>add</mat-icon>
      Import Tax Rates
    </button>

    <!-- Main content grid with list-detail pattern -->
    <div class="grid grid-cols-1 gap-4">
      <!-- Loading state -->
      @if (importedQuery.isLoading()) {
        <div
          class="bg-surface text-on-surface flex animate-pulse cursor-progress flex-col gap-2 rounded-2xl p-4"
        >
          <h2 class="title-medium">Loading tax rates...</h2>
        </div>
      }

      <!-- Error state -->
      @else if (importedQuery.error()) {
        <div class="bg-error-container text-on-error-container rounded-2xl p-4">
          <div class="flex items-center gap-2">
            <mat-icon>error</mat-icon>
            <span class="body-medium"
              >Failed to load tax rates:
              {{ importedQuery.error()?.message }}</span
            >
          </div>
        </div>
      }

      <!-- Empty state -->
      @else if (
        importedRates().length === 0 && incompatibleRates().length === 0
      ) {
        <div
          class="bg-surface-container-low text-on-surface flex flex-col items-center justify-center rounded-2xl p-8"
        >
          <mat-icon class="mb-4 text-6xl text-on-surface-variant"
            >receipt</mat-icon
          >
          <h2 class="title-medium mb-2">No tax rates imported</h2>
          <p class="body-medium text-on-surface-variant mb-4 text-center">
            Import tax rates from your payment provider to enable paid
            registration options.
          </p>
          <button mat-button color="primary" (click)="openImportDialog()">
            Import Your First Tax Rate
          </button>
        </div>
      }

      <!-- Content sections -->
      @else {
        <!-- Compatible rates section -->
        @if (importedRates().length > 0) {
          <div class="bg-surface-container-low text-on-surface rounded-2xl p-4">
            <div class="mb-4">
              <h2 class="title-small">Compatible Tax Rates</h2>
              <p class="body-medium text-on-surface-variant">
                Available for use in your events and templates
              </p>
            </div>

            <div class="bg-surface rounded-2xl overflow-hidden">
              <table mat-table [dataSource]="importedRates()" class="w-full">
                <!-- Name Column -->
                <ng-container matColumnDef="displayName">
                  <th mat-header-cell *matHeaderCellDef class="title-small">
                    Name
                  </th>
                  <td mat-cell *matCellDef="let rate" class="body-medium">
                    {{ rate.displayName || 'Unnamed Rate' }}
                  </td>
                </ng-container>

                <!-- Percentage Column -->
                <ng-container matColumnDef="percentage">
                  <th mat-header-cell *matHeaderCellDef class="title-small">
                    Rate
                  </th>
                  <td mat-cell *matCellDef="let rate">
                    @if (rate.percentage === '0') {
                      <mat-chip
                        class="bg-tertiary-container text-on-tertiary-container"
                        >Tax Free</mat-chip
                      >
                    } @else {
                      <span class="body-medium">{{ rate.percentage }}%</span>
                    }
                  </td>
                </ng-container>

                <!-- Region Column -->
                <ng-container matColumnDef="region">
                  <th mat-header-cell *matHeaderCellDef class="title-small">
                    Region
                  </th>
                  <td mat-cell *matCellDef="let rate">
                    @if (rate.country || rate.state) {
                      <span class="body-medium"
                        >{{ rate.country
                        }}{{ rate.state ? ', ' + rate.state : '' }}</span
                      >
                    } @else {
                      <span class="body-medium text-on-surface-variant"
                        >Global</span
                      >
                    }
                  </td>
                </ng-container>

                <!-- Status Column -->
                <ng-container matColumnDef="status">
                  <th mat-header-cell *matHeaderCellDef class="title-small">
                    Status
                  </th>
                  <td mat-cell *matCellDef="let rate">
                    <mat-chip
                      class="bg-primary-container text-on-primary-container"
                      >Compatible</mat-chip
                    >
                  </td>
                </ng-container>

                <!-- Provider ID Column -->
                <ng-container matColumnDef="stripeTaxRateId">
                  <th mat-header-cell *matHeaderCellDef class="title-small">
                    Provider ID
                  </th>
                  <td mat-cell *matCellDef="let rate">
                    <code
                      class="bg-surface-variant text-on-surface-variant px-2 py-1 rounded font-mono text-sm"
                    >
                      {{ rate.stripeTaxRateId }}
                    </code>
                  </td>
                </ng-container>

                <tr mat-header-row *matHeaderRowDef="displayedColumns"></tr>
                <tr
                  mat-row
                  *matRowDef="let row; columns: displayedColumns"
                  class="hover:bg-surface-container transition-colors"
                ></tr>
              </table>
            </div>
          </div>
        }

        <!-- Incompatible rates section -->
        @if (incompatibleRates().length > 0) {
          <div class="bg-surface-container-low text-on-surface rounded-2xl p-4">
            <div class="mb-4">
              <h2 class="title-small">Incompatible Rates</h2>
              <p class="body-medium text-on-surface-variant">
                Cannot be used for new registration options but shown for
                reference
              </p>
            </div>

            <div class="bg-surface rounded-2xl overflow-hidden opacity-60">
              <table
                mat-table
                [dataSource]="incompatibleRates()"
                class="w-full"
              >
                <!-- Use same column definitions -->
                <ng-container matColumnDef="displayName">
                  <th mat-header-cell *matHeaderCellDef class="title-small">
                    Name
                  </th>
                  <td mat-cell *matCellDef="let rate" class="body-medium">
                    {{ rate.displayName || 'Unnamed Rate' }}
                  </td>
                </ng-container>

                <ng-container matColumnDef="percentage">
                  <th mat-header-cell *matHeaderCellDef class="title-small">
                    Rate
                  </th>
                  <td mat-cell *matCellDef="let rate">
                    @if (rate.percentage === '0') {
                      <mat-chip
                        class="bg-surface-variant text-on-surface-variant"
                        >Tax Free</mat-chip
                      >
                    } @else {
                      <span class="body-medium">{{ rate.percentage }}%</span>
                    }
                  </td>
                </ng-container>

                <ng-container matColumnDef="region">
                  <th mat-header-cell *matHeaderCellDef class="title-small">
                    Region
                  </th>
                  <td mat-cell *matCellDef="let rate">
                    @if (rate.country || rate.state) {
                      <span class="body-medium"
                        >{{ rate.country
                        }}{{ rate.state ? ', ' + rate.state : '' }}</span
                      >
                    } @else {
                      <span class="body-medium text-on-surface-variant"
                        >Global</span
                      >
                    }
                  </td>
                </ng-container>

                <ng-container matColumnDef="status">
                  <th mat-header-cell *matHeaderCellDef class="title-small">
                    Status
                  </th>
                  <td mat-cell *matCellDef="let rate">
                    @if (!rate.inclusive) {
                      <mat-chip
                        class="bg-error-container text-on-error-container"
                        >Exclusive</mat-chip
                      >
                    } @else if (!rate.active) {
                      <mat-chip
                        class="bg-error-container text-on-error-container"
                        >Inactive</mat-chip
                      >
                    }
                  </td>
                </ng-container>

                <ng-container matColumnDef="stripeTaxRateId">
                  <th mat-header-cell *matHeaderCellDef class="title-small">
                    Provider ID
                  </th>
                  <td mat-cell *matCellDef="let rate">
                    <code
                      class="bg-surface-variant text-on-surface-variant px-2 py-1 rounded font-mono text-sm"
                    >
                      {{ rate.stripeTaxRateId }}
                    </code>
                  </td>
                </ng-container>

                <tr mat-header-row *matHeaderRowDef="displayedColumns"></tr>
                <tr
                  mat-row
                  *matRowDef="let row; columns: displayedColumns"
                  class="hover:bg-surface-container transition-colors"
                ></tr>
              </table>
            </div>
          </div>
        }
      }
    </div>
  `,
})
export class TaxRatesSettingsComponent {
  protected readonly displayedColumns = [
    'displayName',
    'percentage',
    'region',
    'status',
    'stripeTaxRateId',
  ];
  private readonly trpc = injectTRPC();

  protected readonly importedQuery = injectQuery(() =>
    this.trpc.admin.tenant.listImportedTaxRates.queryOptions(),
  );

  protected readonly importedRates = computed(() => {
    const rates = this.importedQuery.data() ?? [];
    return rates.filter((rate) => rate.inclusive && rate.active);
  });

  protected readonly incompatibleRates = computed(() => {
    const rates = this.importedQuery.data() ?? [];
    return rates.filter((rate) => !rate.inclusive || !rate.active);
  });

  private readonly dialog = inject(MatDialog);

  protected openImportDialog(): void {
    const dialogReference = this.dialog.open(ImportTaxRatesDialogComponent, {
      disableClose: true,
      width: '800px',
    });

    dialogReference.afterClosed().subscribe((result) => {
      if (result) {
        // Refresh the imported rates list
        this.importedQuery.refetch();
      }
    });
  }
}
