import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  form,
  FormField,
  pattern,
  required,
  submit,
} from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import {
  injectMutation,
  injectQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';

import { ConfigService } from '../../core/config.service';
import { AppRpc } from '../../core/effect-rpc-angular-client';
import { NotificationService } from '../../core/notification.service';
import { TenantDatePipe } from '../../core/tenant-date.pipe';
import {
  esnCardActionDisabled,
  esnCardActionLabel,
  type EsnCardMutationAction,
  esnCardMutationErrorMessage,
  esnCardSaveDisabled,
  esnCardStatusLabel,
  esnCardSubmitPayloadFromIdentifier,
  isEsnCardNotFoundError,
} from './profile-discounts.esn-card';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormField,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    TenantDatePipe,
  ],
  selector: 'app-profile-discounts',
  templateUrl: './profile-discounts.component.html',
})
export class ProfileDiscountsComponent {
  private readonly config = inject(ConfigService);
  private readonly esnProvider = computed(
    () => this.config.tenantSignal()?.discountProviders?.esnCard,
  );
  protected readonly buyEsnCardUrl = computed(() => {
    const buyEsnCardUrl = this.esnProvider()?.config.buyEsnCardUrl?.trim();
    return buyEsnCardUrl && buyEsnCardUrl.length > 0
      ? buyEsnCardUrl
      : undefined;
  });
  private readonly rpc = AppRpc.injectClient();
  protected readonly deleteCardMutation = injectMutation(() =>
    this.rpc.discounts.deleteMyCard.mutationOptions(),
  );
  protected readonly esnCardActionDisabled = esnCardActionDisabled;
  protected readonly esnCardActionLabel = esnCardActionLabel;
  protected readonly esnCardErrorMessage = signal<null | string>(null);
  private readonly esnCardModel = signal({ identifier: '' });
  protected readonly esnCardForm = form(this.esnCardModel, (schemaPath) => {
    required(schemaPath.identifier);
    pattern(schemaPath.identifier, /^[A-Za-z0-9]{8,16}$/);
  });
  protected readonly esnCardSaveDisabled = esnCardSaveDisabled;
  protected readonly esnCardStatusLabel = esnCardStatusLabel;
  protected readonly esnEnabled = computed(
    () => this.esnProvider()?.status === 'enabled',
  );
  protected readonly myCardsQuery = injectQuery(() => ({
    ...this.rpc.discounts.getMyCards.queryOptions(),
    enabled: this.esnEnabled(),
  }));
  protected readonly hasVerifiedEsnCard = computed(() => {
    if (!this.myCardsQuery.isSuccess()) return false;
    return this.myCardsQuery
      .data()
      .some((card) => card.type === 'esnCard' && card.status === 'verified');
  });
  protected readonly refreshCardMutation = injectMutation(() =>
    this.rpc.discounts.refreshMyCard.mutationOptions(),
  );
  protected readonly upsertCardMutation = injectMutation(() =>
    this.rpc.discounts.upsertMyCard.mutationOptions(),
  );

  private readonly notifications = inject(NotificationService);
  private readonly queryClient = inject(QueryClient);

  protected deleteEsnCard(): void {
    if (this.esnCardMutationPending()) {
      return;
    }

    this.esnCardErrorMessage.set(null);
    this.deleteCardMutation.mutate(
      { type: 'esnCard' },
      {
        onError: async (error) => {
          await this.showEsnCardMutationError('remove', error);
        },
        onSuccess: async () => {
          await this.queryClient.invalidateQueries(
            this.rpc.queryFilter(['discounts', 'getMyCards']),
          );
          this.esnCardErrorMessage.set(null);
          this.notifications.showSuccess('ESNcard removed');
        },
      },
    );
  }

  protected refreshEsnCard(): void {
    if (this.esnCardMutationPending()) {
      return;
    }

    this.esnCardErrorMessage.set(null);
    this.refreshCardMutation.mutate(
      { type: 'esnCard' },
      {
        onError: async (error) => {
          await this.showEsnCardMutationError('refresh', error);
        },
        onSuccess: async () => {
          await this.queryClient.invalidateQueries(
            this.rpc.queryFilter(['discounts', 'getMyCards']),
          );
          this.esnCardErrorMessage.set(null);
          this.notifications.showSuccess('ESNcard checked');
        },
      },
    );
  }

  protected async saveEsnCard(event: Event): Promise<void> {
    event.preventDefault();
    if (this.esnCardMutationPending()) {
      return;
    }

    this.esnCardErrorMessage.set(null);
    await submit(this.esnCardForm, async (formState) => {
      this.upsertCardMutation.mutate(
        esnCardSubmitPayloadFromIdentifier(formState().value().identifier),
        {
          onError: async (error) => {
            await this.showEsnCardMutationError('save', error);
          },
          onSuccess: async () => {
            await this.queryClient.invalidateQueries(
              this.rpc.queryFilter(['discounts', 'getMyCards']),
            );
            this.esnCardModel.set({ identifier: '' });
            this.esnCardErrorMessage.set(null);
            this.notifications.showSuccess('ESNcard saved');
          },
        },
      );
    });
  }

  private esnCardMutationPending(): boolean {
    return esnCardActionDisabled({
      deletePending: this.deleteCardMutation.isPending(),
      refreshPending: this.refreshCardMutation.isPending(),
      upsertPending: this.upsertCardMutation.isPending(),
    });
  }

  private async showEsnCardMutationError(
    action: EsnCardMutationAction,
    error: unknown,
  ): Promise<void> {
    this.esnCardErrorMessage.set(esnCardMutationErrorMessage(action, error));
    if (!isEsnCardNotFoundError(error)) {
      return;
    }

    const result = await this.myCardsQuery.refetch();
    this.esnCardErrorMessage.set(
      result.isSuccess
        ? 'This ESNcard was already removed. Your card list is now up to date.'
        : 'This ESNcard is no longer saved. Your card list could not be updated. Select Try again above.',
    );
  }
}
