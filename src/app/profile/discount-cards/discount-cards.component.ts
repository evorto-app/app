import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { RouterLink } from '@angular/router';
import { EsnCardIconComponent } from '@app/core/icons/esn-card-icon/esn-card-icon.component';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { faArrowLeft, faIdCard } from '@fortawesome/duotone-regular-svg-icons';
import { injectMutation, injectQuery } from '@tanstack/angular-query-experimental';

import { injectTRPC } from '../../core/trpc-client';

const validDiscountCardStatuses = ['expired', 'invalid', 'unverified', 'verified'] as const;
const discountCardProviderTypes = ['esnCard'] as const;

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    RouterLink,
    FontAwesomeModule,
    EsnCardIconComponent,
  ],
  selector: 'app-discount-cards',
  standalone: true,
  templateUrl: './discount-cards.component.html',
})
export class DiscountCardsComponent {
  private trpc = injectTRPC();
  cardsQuery = injectQuery(() => this.trpc.discounts.getMyCards.queryOptions());
  private snackBar = inject(MatSnackBar);
  deleteMutation = injectMutation(() =>
    this.trpc.discounts.deleteMyCard.mutationOptions({
      onError: (error: unknown) => {
        this.snackBar.open(`Failed to delete card: ${this.getErrorMessage(error)}`, 'Close', {
          duration: 5000,
        });
      },
      onSuccess: () => {
        this.snackBar.open('Card deleted successfully', 'Close', {
          duration: 3000,
        });
        this.cardsQuery.refetch();
      },
    }),
  );

  refreshMutation = injectMutation(() =>
    this.trpc.discounts.refreshMyCard.mutationOptions({
      onError: (error: unknown) => {
        this.snackBar.open(`Failed to refresh card: ${this.getErrorMessage(error)}`, 'Close', {
          duration: 5000,
        });
      },
      onSuccess: () => {
        this.snackBar.open('Card refreshed successfully', 'Close', {
          duration: 3000,
        });
        this.cardsQuery.refetch();
      },
    }),
  );

  tenantQuery = injectQuery(() => this.trpc.config.tenant.queryOptions());

  private cardControls = new Map<string, FormControl<string>>();

  upsertMutation = injectMutation(() =>
    this.trpc.discounts.upsertMyCard.mutationOptions({
      onError: (error: unknown) => {
        this.snackBar.open(`Failed to add card: ${this.getErrorMessage(error)}`, 'Close', {
          duration: 5000,
        });
      },
      onSuccess: () => {
        this.snackBar.open('Card added successfully', 'Close', {
          duration: 3000,
        });
        this.cardsQuery.refetch();
        // Clear the form
        this.cardControls.clear();
      },
    }),
  );

  protected readonly faArrowLeft = faArrowLeft;

  protected readonly faIdCard = faIdCard;

  addCard(providerType: string): void {
    const control = this.getCardControl(providerType);
    if (control.valid) {
      this.upsertMutation.mutate({
        identifier: control.value,
        type: providerType as 'esnCard',
      });
    }
  }

  deleteCard(providerType: string): void {
    if (confirm('Are you sure you want to delete this card?')) {
      this.deleteMutation.mutate({ type: providerType as 'esnCard' });
    }
  }

  getCardControl(providerType: string): FormControl<string> {
    const existingControl = this.cardControls.get(providerType);
    if (existingControl) {
      return existingControl;
    }
    const control = new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(3)],
    });
    this.cardControls.set(providerType, control);
    return control;
  }

  getProviderDescription(type: string): string {
    const descriptions: Record<string, string> = {
      esnCard: 'European Student Network membership card',
    };
    return descriptions[type] || `${type} discount card`;
  }

  getProviderDisplayName(type: string): string {
    const names: Record<string, string> = {
      esnCard: 'ESNcard',
    };
    return names[type] || type;
  }

  getStatusDisplay(status: string): string {
    const statusDisplay: Record<string, string> = {
      expired: 'Expired',
      invalid: 'Invalid',
      unverified: 'Unverified',
      verified: 'Verified ✓',
    };
    return statusDisplay[status] || status;
  }

  getUserCard(cards: DiscountCard[], providerType: DiscountCardType) {
    return cards.find((card) => card.type === providerType);
  }

  hasValidCard(
    cards: DiscountCard[],
    providerType: DiscountCardType,
  ) {
    const card = this.getUserCard(cards, providerType);
    if (!card) return false;
    return this.isCardValid(card);
  }

  isCardValid(card: DiscountCard): boolean {
    if (card.status !== 'verified') {
      return false;
    }
    if (!card.validTo) {
      return true;
    }
    return card.validTo > new Date();
  }

  refreshCard(providerType: string): void {
    this.refreshMutation.mutate({ type: providerType as 'esnCard' });
  }

  private getErrorMessage(error: unknown): string {
    if (error && typeof error === 'object' && 'message' in error) {
      const message = (error as { message?: unknown }).message;
      if (typeof message === 'string') {
        return message;
      }
    }
    return 'Unknown error';
  }
}

type DiscountCardType = (typeof discountCardProviderTypes)[number] | string;

type DiscountCard = {
  identifier: string;
  status: (typeof validDiscountCardStatuses)[number];
  type: DiscountCardType;
  validTo?: Date | null;
};
