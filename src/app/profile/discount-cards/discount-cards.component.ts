import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { injectMutation, injectQuery } from '@tanstack/angular-query-experimental';

import { injectTRPC } from '../../core/trpc-client';

@Component({
  selector: 'app-discount-cards',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
  ],
  template: `
    <div class="p-6">
      <h1 class="text-2xl font-bold mb-6">Discount Cards</h1>

      @if (tenantQuery.data(); as tenant) {
        @if (tenant.discountProviders?.esnCard?.enabled === true) {
            <mat-card class="mb-6">
              <div class="p-6">
                <div class="flex items-center gap-4 mb-4">
                  <mat-icon class="text-blue-600">credit_card</mat-icon>
                  <div>
                    <h3 class="text-lg font-semibold">{{ getProviderDisplayName('esnCard') }}</h3>
                    <p class="text-gray-600">{{ getProviderDescription('esnCard') }}</p>
                  </div>
                </div>

                @if (cardsQuery.data(); as cards) {
                  @if (getUserCard(cards, 'esnCard'); as card) {
                    <!-- User has a card -->
                    <div class="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
                      <div class="flex items-center justify-between">
                        <div>
                          <p class="font-medium text-green-800">Card: {{ card.identifier }}</p>
                          <p class="text-sm text-green-600">
                            Status: {{ getStatusDisplay(card.status) }}
                            @if (card.validTo) {
                              | Valid until: {{ card.validTo | date }}
                            }
                          </p>
                        </div>
                        <div class="flex gap-2">
                          <button
                            mat-stroked-button
                            color="primary"
                            (click)="refreshCard('esnCard')"
                            [disabled]="refreshMutation.isPending()"
                            data-testid="refresh-esn-card">
                            @if (refreshMutation.isPending()) {
                              Refreshing...
                            } @else {
                              Refresh
                            }
                          </button>
                          <button
                            mat-stroked-button
                            color="warn"
                            (click)="deleteCard('esnCard')"
                            [disabled]="deleteMutation.isPending()"
                            data-testid="delete-esn-card">
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  } @else {
                    <!-- User doesn't have a card -->
                    @if (tenant.discountProviders?.esnCard?.config?.ctaEnabled === true && tenant.discountProviders?.esnCard?.config?.ctaLink) {
                      <div class="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4" data-testid="esn-cta-section">
                        <p class="text-blue-800 mb-2">
                          Get discounts on events with your {{ getProviderDisplayName('esnCard') }}!
                        </p>
                        <a
                          [href]="tenant.discountProviders?.esnCard?.config?.ctaLink"
                          target="_blank"
                          class="text-blue-600 hover:text-blue-800 underline"
                          data-testid="get-esncard-link">
                          Get your ESNcard →
                        </a>
                      </div>
                    }

                    <div class="space-y-4">
                      <mat-form-field class="w-full">
                        <mat-label>{{ getProviderDisplayName('esnCard') }} Number</mat-label>
                        <input
                          matInput
                          [formControl]="getCardControl('esnCard')"
                          placeholder="Enter your card number"
                          data-testid="esn-card-input">
                      </mat-form-field>

                      <button
                        mat-raised-button
                        color="primary"
                        (click)="addCard('esnCard')"
                        [disabled]="!getCardControl('esnCard').valid || upsertMutation.isPending()"
                        data-testid="add-esn-card-button">
                        @if (upsertMutation.isPending()) {
                          Adding Card...
                        } @else {
                          Add Card
                        }
                      </button>
                    </div>
                  }
                }
              </div>
            </mat-card>
          }
        }

      @if (cardsQuery.isLoading() || tenantQuery.isLoading()) {
        <div class="text-center py-8">Loading discount cards...</div>
      }

      @if (cardsQuery.isError() || tenantQuery.isError()) {
        <div class="text-red-500 text-center py-8">
          Failed to load discount information
        </div>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DiscountCardsComponent {
  private snackBar = inject(MatSnackBar);
  private trpc = injectTRPC();

  tenantQuery = injectQuery(() =>
    this.trpc.config.tenant.queryOptions(),
  );

  cardsQuery = injectQuery(() =>
    this.trpc.discounts.getMyCards.queryOptions(),
  );

  upsertMutation = injectMutation(() =>
    this.trpc.discounts.upsertMyCard.mutationOptions({
      onSuccess: () => {
        this.snackBar.open('Card added successfully', 'Close', { duration: 3000 });
        this.cardsQuery.refetch();
        // Clear the form
        this.cardControls.clear();
      },
      onError: (error: any) => {
        this.snackBar.open(`Failed to add card: ${error.message}`, 'Close', { duration: 5000 });
      },
    }),
  );

  refreshMutation = injectMutation(() =>
    this.trpc.discounts.refreshMyCard.mutationOptions({
      onSuccess: () => {
        this.snackBar.open('Card refreshed successfully', 'Close', { duration: 3000 });
        this.cardsQuery.refetch();
      },
      onError: (error: any) => {
        this.snackBar.open(`Failed to refresh card: ${error.message}`, 'Close', { duration: 5000 });
      },
    }),
  );

  deleteMutation = injectMutation(() =>
    this.trpc.discounts.deleteMyCard.mutationOptions({
      onSuccess: () => {
        this.snackBar.open('Card deleted successfully', 'Close', { duration: 3000 });
        this.cardsQuery.refetch();
      },
      onError: (error: any) => {
        this.snackBar.open(`Failed to delete card: ${error.message}`, 'Close', { duration: 5000 });
      },
    }),
  );

  private cardControls = new Map<string, FormControl<string>>();

  getCardControl(providerType: string): FormControl<string> {
    if (!this.cardControls.has(providerType)) {
      this.cardControls.set(providerType, new FormControl('', {
        nonNullable: true,
        validators: [Validators.required, Validators.minLength(3)]
      }));
    }
    return this.cardControls.get(providerType)!;
  }

  getUserCard(cards: any[], providerType: string) {
    return cards.find(card => card.type === providerType);
  }

  getProviderDisplayName(type: string): string {
    const names: Record<string, string> = {
      esnCard: 'ESNcard',
    };
    return names[type] || type;
  }

  getProviderDescription(type: string): string {
    const descriptions: Record<string, string> = {
      esnCard: 'European Student Network membership card',
    };
    return descriptions[type] || `${type} discount card`;
  }

  getStatusDisplay(status: string): string {
    const statusDisplay: Record<string, string> = {
      verified: 'Verified ✓',
      unverified: 'Unverified',
      expired: 'Expired',
      invalid: 'Invalid',
    };
    return statusDisplay[status] || status;
  }

  addCard(providerType: string): void {
    const control = this.getCardControl(providerType);
    if (control.valid) {
      this.upsertMutation.mutate({
        type: providerType as 'esnCard',
        identifier: control.value,
      });
    }
  }

  refreshCard(providerType: string): void {
    this.refreshMutation.mutate({ type: providerType as 'esnCard' });
  }

  deleteCard(providerType: string): void {
    if (confirm('Are you sure you want to delete this card?')) {
      this.deleteMutation.mutate({ type: providerType as 'esnCard' });
    }
  }
}
