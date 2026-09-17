import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  disabled,
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
  isEsnCardChangedError,
  isEsnCardNotFoundError,
  isEsnCardUnconfirmedError,
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
  protected readonly activeCardAction = signal<EsnCardMutationAction | null>(
    null,
  );
  private readonly config = inject(ConfigService);
  private readonly esnProvider = computed(
    () => this.config.tenantSignal()?.discountProviders.esnCard,
  );
  protected readonly buyEsnCardUrl = computed(() => {
    const buyEsnCardUrl = this.esnProvider()?.config.buyEsnCardUrl?.trim();
    return buyEsnCardUrl && buyEsnCardUrl.length > 0
      ? buyEsnCardUrl
      : undefined;
  });
  protected readonly cardReadPending = signal(false);
  protected readonly confirmedCardAction = signal<EsnCardMutationAction | null>(
    null,
  );
  private readonly rpc = AppRpc.injectClient();
  protected readonly deleteCardMutation = injectMutation(() =>
    this.rpc.discounts.deleteMyCard.mutationOptions(),
  );
  protected readonly esnCardActionDisabled = esnCardActionDisabled;
  protected readonly esnCardActionLabel = esnCardActionLabel;
  protected readonly esnCardErrorMessage = signal<null | string>(null);
  protected readonly unconfirmedCardAction =
    signal<EsnCardMutationAction | null>(null);
  private readonly esnCardModel = signal({ identifier: '' });
  protected readonly esnCardForm = form(this.esnCardModel, (schemaPath) => {
    disabled(
      schemaPath.identifier,
      () =>
        this.activeCardAction() !== null ||
        this.cardReadPending() ||
        this.confirmedCardAction() !== null ||
        this.unconfirmedCardAction() !== null,
    );
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

  protected cardOperationBusy(): boolean {
    return (
      this.activeCardAction() !== null ||
      this.cardReadPending() ||
      esnCardActionDisabled({
        deletePending: this.deleteCardMutation.isPending(),
        refreshPending: this.refreshCardMutation.isPending(),
        upsertPending: this.upsertCardMutation.isPending(),
      })
    );
  }

  protected async deleteEsnCard(): Promise<void> {
    await this.runEsnCardMutation('remove', () =>
      this.deleteCardMutation.mutateAsync({ type: 'esnCard' }),
    );
  }

  protected esnCardMutationPending(): boolean {
    return (
      this.cardOperationBusy() ||
      this.confirmedCardAction() !== null ||
      this.unconfirmedCardAction() !== null
    );
  }

  protected async readSavedCards(): Promise<void> {
    if (this.cardOperationBusy() || !this.esnEnabled()) return;
    const confirmedAction = this.confirmedCardAction();
    const unconfirmedAction = this.unconfirmedCardAction();
    this.cardReadPending.set(true);
    try {
      await this.refreshCardList();
      if (confirmedAction) this.completeConfirmedCardRead(confirmedAction);
      else {
        this.unconfirmedCardAction.set(null);
        this.esnCardErrorMessage.set(null);
      }
    } catch {
      this.esnCardErrorMessage.set(
        confirmedAction
          ? this.confirmedCardReadFailure(confirmedAction)
          : unconfirmedAction
            ? `Your current cards could not be loaded. ${esnCardMutationErrorMessage(unconfirmedAction, null)}`
            : 'Your discount cards could not be loaded. Select Try again.',
      );
    } finally {
      this.cardReadPending.set(false);
    }
  }

  protected async refreshEsnCard(): Promise<void> {
    await this.runEsnCardMutation('refresh', () =>
      this.refreshCardMutation.mutateAsync({ type: 'esnCard' }),
    );
  }

  protected async saveEsnCard(event: Event): Promise<void> {
    event.preventDefault();
    if (this.esnCardMutationPending() || !this.esnEnabled()) return;
    await submit(this.esnCardForm, async (formState) => {
      const input = esnCardSubmitPayloadFromIdentifier(
        formState().value().identifier,
      );
      await this.runEsnCardMutation('save', () =>
        this.upsertCardMutation.mutateAsync(input),
      );
    });
  }

  private completeConfirmedCardRead(action: EsnCardMutationAction): void {
    if (action === 'save') this.esnCardModel.set({ identifier: '' });
    this.confirmedCardAction.set(null);
    this.esnCardErrorMessage.set(null);
    this.notifications.showSuccess(
      action === 'save'
        ? 'ESNcard saved'
        : action === 'remove'
          ? 'ESNcard removed'
          : 'ESNcard checked',
    );
  }

  private confirmedCardReadFailure(action: EsnCardMutationAction): string {
    const result =
      action === 'save' ? 'saved' : action === 'remove' ? 'removed' : 'checked';
    return `Your ESNcard was ${result}, but your card list could not be updated. Select Try again to load your current cards before making another change.`;
  }

  private async refreshCardList(): Promise<void> {
    const filter = this.rpc.queryFilter(['discounts', 'getMyCards']);
    const invalidation = this.queryClient.invalidateQueries(filter, {
      throwOnError: true,
    });
    const activeQueries = this.queryClient
      .getQueryCache()
      .findAll({ ...filter, type: 'active' })
      .filter((query) => !query.isDisabled() && !query.isStatic());
    const activeReads = activeQueries
      .filter((query) => query.state.fetchStatus === 'fetching')
      .map((query) => query.promise);
    const results = await Promise.allSettled([invalidation, ...activeReads]);
    const failures: unknown[] = [];
    for (const result of results) {
      if (result.status === 'rejected') failures.push(result.reason);
    }
    if (failures.length > 0)
      throw new AggregateError(failures, 'ESNcard follow-up reads failed');
    if (
      activeQueries.length === 0 ||
      activeQueries.some(
        (query) =>
          query.state.status !== 'success' ||
          query.state.fetchStatus !== 'idle' ||
          query.state.isInvalidated,
      )
    ) {
      throw new Error(
        'A successful current card read is required before another card change',
      );
    }
  }

  private async runEsnCardMutation<T>(
    action: EsnCardMutationAction,
    mutation: () => Promise<T>,
  ): Promise<void> {
    if (this.esnCardMutationPending() || !this.esnEnabled()) return;
    this.activeCardAction.set(action);
    this.esnCardErrorMessage.set(null);
    try {
      try {
        await mutation();
      } catch (error) {
        await this.showEsnCardMutationError(action, error);
        return;
      }
      this.confirmedCardAction.set(action);
      try {
        await this.refreshCardList();
      } catch {
        this.esnCardErrorMessage.set(this.confirmedCardReadFailure(action));
        return;
      }
      this.completeConfirmedCardRead(action);
    } finally {
      this.activeCardAction.set(null);
    }
  }

  private async showEsnCardMutationError(
    action: EsnCardMutationAction,
    error: unknown,
  ): Promise<void> {
    this.esnCardErrorMessage.set(esnCardMutationErrorMessage(action, error));
    if (isEsnCardUnconfirmedError(error)) {
      this.unconfirmedCardAction.set(action);
      return;
    }
    const cardChanged = isEsnCardChangedError(error);
    if (!cardChanged && !isEsnCardNotFoundError(error)) {
      return;
    }

    const result = await this.myCardsQuery.refetch();
    if (cardChanged) {
      this.esnCardErrorMessage.set(
        result.isSuccess
          ? 'Your saved ESNcard changed while it was being checked. The old check was not saved. Review your current card before checking again.'
          : 'Your saved ESNcard changed while it was being checked. The old check was not saved, and your card list could not be updated. Select Try again above.',
      );
      return;
    }
    this.esnCardErrorMessage.set(
      result.isSuccess
        ? 'This ESNcard was already removed. Your card list is now up to date.'
        : 'This ESNcard is no longer saved. Your card list could not be updated. Select Try again above.',
    );
  }
}
