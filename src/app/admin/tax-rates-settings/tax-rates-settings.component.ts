import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog } from '@angular/material/dialog';
import { MatTableModule } from '@angular/material/table';
import { RouterLink } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import {
  faArrowLeft,
  faCircleExclamation,
  faReceipt,
} from '@fortawesome/duotone-regular-svg-icons';
import { injectQuery } from '@tanstack/angular-query-experimental';

import { AppRpc } from '../../core/effect-rpc-angular-client';
import { taxRateRegionLabel } from '../../core/geography-labels';
import {
  ImportTaxRatesDialogComponent,
  type ImportTaxRatesDialogData,
} from '../components/import-tax-rates-dialog/import-tax-rates-dialog.component';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FontAwesomeModule,
    RouterLink,
    MatButtonModule,
    MatCardModule,
    MatChipsModule,
    MatTableModule,
  ],
  selector: 'app-tax-rates-settings',
  styles: [``],
  template: `
    <!-- Header with navigation -->
    <div class="mb-4 flex flex-row items-center gap-2">
      <a routerLink="/admin" mat-icon-button class="lg:hidden! block">
        <fa-duotone-icon [icon]="faArrowLeft" />
      </a>
      <h1 class="title-large">Tax rates</h1>
    </div>

    <!-- FAB for primary action -->
    <button
      mat-fab
      extended
      class="fab-fixed"
      (click)="openImportDialog()"
      [disabled]="!importedQuery.isSuccess()"
    >
      <fa-duotone-icon [icon]="faReceipt" />
      Add tax rates
    </button>

    <!-- Main content grid with list-detail pattern -->
    <div class="grid grid-cols-1 gap-4">
      <!-- Loading state -->
      @if (importedQuery.isLoading()) {
        <div
          class="bg-surface text-on-surface flex animate-pulse cursor-progress flex-col gap-2 rounded-2xl p-4"
        >
          <h2 class="title-medium">Loading tax rates…</h2>
        </div>
      }

      <!-- Error state -->
      @else if (importedQuery.error()) {
        <div
          class="bg-error-container text-on-error-container flex flex-col items-start gap-3 rounded-2xl p-4"
          role="alert"
        >
          <div class="flex items-center gap-2">
            <fa-duotone-icon [icon]="faCircleExclamation" />
            <span class="body-medium">We couldn't load the tax rates.</span>
          </div>
          <button
            mat-stroked-button
            type="button"
            [disabled]="importedQuery.isFetching()"
            (click)="importedQuery.refetch()"
          >
            {{ importedQuery.isFetching() ? 'Trying again…' : 'Try again' }}
          </button>
        </div>
      }

      <!-- Empty state -->
      @else if (
        importedRates().length === 0 && incompatibleRates().length === 0
      ) {
        <div
          class="bg-surface-container-low text-on-surface flex flex-col items-center justify-center rounded-2xl p-8"
        >
          <fa-duotone-icon
            [icon]="faReceipt"
            class="mb-4 text-6xl text-on-surface-variant"
          />
          <h2 class="title-medium mb-2">No tax rates added</h2>
          <p class="body-medium text-on-surface-variant mb-4 text-center">
            Add tax rates to enable paid sign-up choices.
          </p>
          <button mat-button color="primary" (click)="openImportDialog()">
            Add your first tax rate
          </button>
        </div>
      }

      <!-- Content sections -->
      @else {
        <!-- Compatible rates section -->
        @if (importedRates().length > 0) {
          <div class="bg-surface-container-low text-on-surface rounded-2xl p-4">
            <div class="mb-4">
              <h2 class="title-small">Available tax rates</h2>
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
                    {{ rate.displayName || 'Unnamed tax rate' }}
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
                        >Tax-free</mat-chip
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
                    <span class="body-medium">
                      {{ taxRateRegionLabel(rate.country, rate.state) }}
                    </span>
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
                      >Available</mat-chip
                    >
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
              <h2 class="title-small">Unavailable tax rates</h2>
              <p class="body-medium text-on-surface-variant">
                Cannot be used for new sign-up choices but shown for reference.
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
                    {{ rate.displayName || 'Unnamed tax rate' }}
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
                        >Tax-free</mat-chip
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
                    <span class="body-medium">
                      {{ taxRateRegionLabel(rate.country, rate.state) }}
                    </span>
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
                        >Tax added when paying</mat-chip
                      >
                    } @else if (!rate.active) {
                      <mat-chip
                        class="bg-error-container text-on-error-container"
                        >Archived</mat-chip
                      >
                    }
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
  ];
  protected readonly faArrowLeft = faArrowLeft;
  protected readonly faCircleExclamation = faCircleExclamation;
  protected readonly faReceipt = faReceipt;
  private readonly rpc = AppRpc.injectClient();
  protected readonly importedQuery = injectQuery(() =>
    this.rpc.admin.tenant.listImportedTaxRates.queryOptions(),
  );

  protected readonly importedRates = computed(() => {
    const rates = this.importedQuery.isSuccess()
      ? this.importedQuery.data()
      : [];
    return rates.filter((rate) => rate.inclusive && rate.active);
  });

  protected readonly incompatibleRates = computed(() => {
    const rates = this.importedQuery.isSuccess()
      ? this.importedQuery.data()
      : [];
    return rates.filter((rate) => !rate.inclusive || !rate.active);
  });

  protected readonly taxRateRegionLabel = taxRateRegionLabel;

  private readonly dialog = inject(MatDialog);

  protected openImportDialog(): void {
    if (!this.importedQuery.isSuccess()) return;

    const dialogReference = this.dialog.open(ImportTaxRatesDialogComponent, {
      data: {
        importedTaxRateIds: this.importedQuery
          .data()
          .map((rate) => rate.stripeTaxRateId),
      } satisfies ImportTaxRatesDialogData,
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
