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
  template: `
    <div class="tax-rates-settings">
      <div class="header">
        <h1>Tax Rates Settings</h1>
        <p class="text-muted-foreground">
          Manage inclusive tax rates for paid registration options. Only rates that are inclusive and active 
          can be used for new events and templates.
        </p>
      </div>

      <div class="actions mb-6">
        <button
          mat-raised-button
          color="primary"
          (click)="openImportDialog()"
          [disabled]="importedQuery.isLoading()"
        >
          <mat-icon>add</mat-icon>
          Import Tax Rates
        </button>
      </div>

      <mat-card>
        <mat-card-header>
          <mat-card-title>Imported Tax Rates</mat-card-title>
          <mat-card-subtitle>
            Tax rates available for use in your events and templates
          </mat-card-subtitle>
        </mat-card-header>
        
        <mat-card-content>
          @if (importedQuery.isLoading()) {
            <div class="loading">Loading tax rates...</div>
          } @else if (importedQuery.error()) {
            <div class="error">
              <mat-icon color="warn">error</mat-icon>
              Failed to load tax rates: {{ importedQuery.error()?.message }}
            </div>
          } @else if (importedRates().length === 0) {
            <div class="empty-state">
              <mat-icon>receipt</mat-icon>
              <h3>No tax rates imported</h3>
              <p>Import tax rates from your payment provider to enable paid registration options.</p>
              <button mat-button color="primary" (click)="openImportDialog()">
                Import Your First Tax Rate
              </button>
            </div>
          } @else {
            <table mat-table [dataSource]="importedRates()" class="tax-rates-table">
              <!-- Name Column -->
              <ng-container matColumnDef="displayName">
                <th mat-header-cell *matHeaderCellDef>Name</th>
                <td mat-cell *matCellDef="let rate">
                  {{ rate.displayName || 'Unnamed Rate' }}
                </td>
              </ng-container>

              <!-- Percentage Column -->
              <ng-container matColumnDef="percentage">
                <th mat-header-cell *matHeaderCellDef>Percentage</th>
                <td mat-cell *matCellDef="let rate">
                  @if (rate.percentage === '0') {
                    <mat-chip color="accent">Tax Free</mat-chip>
                  } @else {
                    {{ rate.percentage }}%
                  }
                </td>
              </ng-container>

              <!-- Region Column -->
              <ng-container matColumnDef="region">
                <th mat-header-cell *matHeaderCellDef>Region</th>
                <td mat-cell *matCellDef="let rate">
                  @if (rate.country || rate.state) {
                    {{ rate.country }}{{ rate.state ? ', ' + rate.state : '' }}
                  } @else {
                    <span class="text-muted-foreground">Global</span>
                  }
                </td>
              </ng-container>

              <!-- Status Column -->
              <ng-container matColumnDef="status">
                <th mat-header-cell *matHeaderCellDef>Status</th>
                <td mat-cell *matCellDef="let rate">
                  @if (rate.inclusive && rate.active) {
                    <mat-chip color="primary">Compatible</mat-chip>
                  } @else if (!rate.inclusive) {
                    <mat-chip color="warn">Exclusive</mat-chip>
                  } @else if (!rate.active) {
                    <mat-chip color="warn">Inactive</mat-chip>
                  }
                </td>
              </ng-container>

              <!-- Provider ID Column -->
              <ng-container matColumnDef="stripeTaxRateId">
                <th mat-header-cell *matHeaderCellDef>Provider ID</th>
                <td mat-cell *matCellDef="let rate">
                  <code class="provider-id">{{ rate.stripeTaxRateId }}</code>
                </td>
              </ng-container>

              <tr mat-header-row *matHeaderRowDef="displayedColumns"></tr>
              <tr mat-row *matRowDef="let row; columns: displayedColumns;"></tr>
            </table>
          }
        </mat-card-content>
      </mat-card>

      @if (incompatibleRates().length > 0) {
        <mat-card class="mt-6">
          <mat-card-header>
            <mat-card-title>Incompatible Rates</mat-card-title>
            <mat-card-subtitle>
              These rates cannot be used for new registration options but are shown for reference
            </mat-card-subtitle>
          </mat-card-header>
          
          <mat-card-content>
            <table mat-table [dataSource]="incompatibleRates()" class="tax-rates-table">
              <tr mat-header-row *matHeaderRowDef="displayedColumns"></tr>
              <tr mat-row *matRowDef="let row; columns: displayedColumns;" class="incompatible-row"></tr>
            </table>
          </mat-card-content>
        </mat-card>
      }
    </div>
  `,
  styles: [`
    .tax-rates-settings {
      max-width: 1200px;
      margin: 0 auto;
      padding: 24px;
    }

    .header {
      margin-bottom: 32px;
    }

    .header h1 {
      margin: 0 0 8px 0;
      font-size: 2rem;
      font-weight: 600;
    }

    .actions {
      display: flex;
      gap: 16px;
      align-items: center;
    }

    .loading, .error {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 24px;
      justify-content: center;
    }

    .empty-state {
      text-align: center;
      padding: 48px 24px;
    }

    .empty-state mat-icon {
      font-size: 48px;
      width: 48px;
      height: 48px;
      color: #666;
      margin-bottom: 16px;
    }

    .empty-state h3 {
      margin: 0 0 8px 0;
      font-size: 1.25rem;
    }

    .empty-state p {
      margin: 0 0 16px 0;
      color: #666;
    }

    .tax-rates-table {
      width: 100%;
    }

    .provider-id {
      background: #f5f5f5;
      padding: 2px 6px;
      border-radius: 4px;
      font-family: monospace;
      font-size: 0.875rem;
    }

    .incompatible-row {
      opacity: 0.6;
    }

    .text-muted-foreground {
      color: #666;
    }

    .mt-6 {
      margin-top: 24px;
    }

    .mb-6 {
      margin-bottom: 24px;
    }
  `]
})
export class TaxRatesSettingsComponent {
  private readonly trpc = injectTRPC();
  private readonly dialog = inject(MatDialog);

  protected readonly displayedColumns = [
    'displayName',
    'percentage', 
    'region',
    'status',
    'stripeTaxRateId'
  ];

  protected readonly importedQuery = injectQuery(() =>
    this.trpc.admin.tenant.listImportedTaxRates.queryOptions()
  );

  protected readonly importedRates = computed(() => {
    const rates = this.importedQuery.data() ?? [];
    return rates.filter(rate => rate.inclusive && rate.active);
  });

  protected readonly incompatibleRates = computed(() => {
    const rates = this.importedQuery.data() ?? [];
    return rates.filter(rate => !rate.inclusive || !rate.active);
  });

  protected openImportDialog(): void {
    const dialogRef = this.dialog.open(ImportTaxRatesDialogComponent, {
      width: '800px',
      disableClose: true,
    });

    dialogRef.afterClosed().subscribe((result) => {
      if (result) {
        // Refresh the imported rates list
        this.importedQuery.refetch();
      }
    });
  }
}