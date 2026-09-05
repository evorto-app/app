import '@angular/compiler';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  createRpcQueryFilter,
  createRpcQueryKey,
} from '@heddendorp/effect-angular-query';
import {
  RpcBadRequestError,
  RpcInternalServerError,
} from '@shared/errors/rpc-errors';
import { ClientTenantConfig } from '@shared/rpc-contracts/app-rpcs/config.rpcs';
import {
  DiscountCardChangedError,
  DiscountCardNotFoundError,
} from '@shared/rpc-contracts/app-rpcs/discounts.errors';
import { DiscountCardRecord } from '@shared/rpc-contracts/app-rpcs/discounts.rpcs';
import {
  isCancelledError,
  onlineManager,
  provideTanStackQuery,
  QueryClient,
  QueryObserver,
} from '@tanstack/angular-query-experimental';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfigService } from '../../core/config.service';
import { APP_RPC_CLIENT, AppRpc } from '../../core/effect-rpc-angular-client';
import { NotificationService } from '../../core/notification.service';
import { TENANT_DATE_PIPE_TIMEZONE } from '../../core/tenant-date.pipe';
import { ProfileDiscountsComponent } from './profile-discounts.component';
import {
  type EsnCardMutationAction,
  esnCardMutationErrorMessage,
} from './profile-discounts.esn-card';

describe('ProfileDiscountsComponent save outcomes', () => {
  type Client = ReturnType<typeof AppRpc.injectClient>;
  type Save = NonNullable<
    ReturnType<
      Client['discounts']['upsertMyCard']['mutationOptions']
    >['mutationFn']
  >;
  type Check = NonNullable<
    ReturnType<
      Client['discounts']['refreshMyCard']['mutationOptions']
    >['mutationFn']
  >;
  type Remove = NonNullable<
    ReturnType<
      Client['discounts']['deleteMyCard']['mutationOptions']
    >['mutationFn']
  >;
  const card: DiscountCardRecord = {
    id: 'card-1',
    identifier: 'ABCD1234',
    status: 'verified',
    type: 'esnCard',
    validTo: null,
  };
  const tenant = new ClientTenantConfig({
    cancellationDeadlineHoursBeforeStart: 24,
    currency: 'EUR',
    defaultLocation: undefined,
    discountProviders: { esnCard: { config: {}, status: 'enabled' } },
    domain: 'tenant.example.test',
    id: 'tenant-1',
    maxActiveRegistrationsPerUser: 3,
    name: 'Tenant',
    paymentsConfigured: true,
    receiptSettings: { allowOther: false, receiptCountries: ['DE'] },
    refundFeesOnCancellation: false,
    theme: 'evorto',
    timezone: 'Europe/Berlin',
    transferDeadlineHoursBeforeStart: 24,
  });
  const tenantSignal = signal<ClientTenantConfig | null>(tenant);
  const save = vi.fn<Save>();
  const submitOperation = vi.fn<(event: Event) => Promise<void>>();
  const check = vi.fn<Check>();
  const remove = vi.fn<Remove>();
  const readCards = vi.fn<() => Promise<readonly DiscountCardRecord[]>>();
  const notifications = {
    showError: vi.fn(),
    showSuccess: vi.fn(),
  } satisfies Pick<NotificationService, 'showError' | 'showSuccess'>;
  const queryKey = createRpcQueryKey<undefined>(['discounts', 'getMyCards'], {
    type: 'query',
  });
  let fixture: ComponentFixture<ProfileDiscountsComponent>;
  let root: HTMLElement;
  let queryClient: QueryClient;
  let operations: Promise<PromiseSettledResult<void>>[];
  let destroyFixture: (() => void) | undefined;
  let clearQueries: (() => void) | undefined;

  const own = (operation: Promise<void>) => {
    operations.push(
      operation.then<PromiseSettledResult<void>, PromiseSettledResult<void>>(
        () => ({ status: 'fulfilled', value: undefined }),
        (error) => ({ reason: error, status: 'rejected' }),
      ),
    );
    return operation;
  };
  const input = () => {
    const element = root.querySelector<HTMLInputElement>('input');
    if (!element) throw new Error('Expected the ESNcard identifier input');
    return element;
  };
  const button = (label: string) => {
    const element = [...root.querySelectorAll('button')].find(
      (candidate) => candidate.textContent?.trim() === label,
    );
    if (!element) throw new Error(`Expected the ${label} button`);
    return element;
  };
  const submitButton = () => {
    const element = root.querySelector<HTMLButtonElement>(
      'button[type="submit"]',
    );
    if (!element) throw new Error('Expected the ESNcard submit button');
    return element;
  };
  const enterIdentifier = async () => {
    input().value = 'NEWCARD12';
    input().dispatchEvent(new Event('input', { bubbles: true }));
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(submitButton().disabled).toBe(false);
    });
  };
  const start = (action: EsnCardMutationAction) => {
    if (action === 'refresh')
      return own(fixture.componentInstance['refreshEsnCard']());
    if (action === 'remove')
      return own(fixture.componentInstance['deleteEsnCard']());
    const event = new Event('submit', { bubbles: true, cancelable: true });
    const formElement = root.querySelector('form');
    if (!formElement)
      return own(fixture.componentInstance['saveEsnCard'](event));
    formElement.dispatchEvent(event);
    const result = submitOperation.mock.results.at(-1);
    if (result?.type !== 'return')
      throw new Error('Expected the actual card form submission operation');
    return own(result.value);
  };
  const message = async (expected: string) => {
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(
        [...root.querySelectorAll('[role="alert"]')].some((alert) =>
          alert.textContent?.includes(expected),
        ),
      ).toBe(true);
    });
  };
  const expectOneMutation = (action: EsnCardMutationAction) => {
    expect(save).toHaveBeenCalledTimes(action === 'save' ? 1 : 0);
    expect(check).toHaveBeenCalledTimes(action === 'refresh' ? 1 : 0);
    expect(remove).toHaveBeenCalledTimes(action === 'remove' ? 1 : 0);
    switch (action) {
      case 'refresh': {
        expect(check.mock.calls[0]?.[0]).toEqual({ type: 'esnCard' });
        break;
      }
      case 'remove': {
        {
          expect(remove.mock.calls[0]?.[0]).toEqual({ type: 'esnCard' });
          // No default
        }
        break;
      }
      case 'save': {
        expect(save.mock.calls[0]?.[0]).toEqual({
          identifier: 'NEWCARD12',
          type: 'esnCard',
        });
        break;
      }
    }
    expect(queryClient.getMutationCache().getAll()).toHaveLength(1);
  };
  const confirmedMessage = (action: EsnCardMutationAction) =>
    `Your ESNcard was ${action === 'save' ? 'saved' : action === 'remove' ? 'removed' : 'checked'}, but your card list could not be updated. Select Try again to load your current cards before making another change.`;

  beforeEach(async () => {
    operations = [];
    destroyFixture = undefined;
    clearQueries = undefined;
    tenantSignal.set(tenant);
    save.mockReset().mockResolvedValue(card);
    check.mockReset().mockResolvedValue(card);
    remove.mockReset().mockResolvedValue(undefined);
    readCards.mockReset().mockResolvedValue([card]);
    notifications.showError.mockReset();
    notifications.showSuccess.mockReset();
    queryClient = new QueryClient({
      defaultOptions: {
        mutations: { gcTime: Infinity, retry: false },
        queries: { gcTime: Infinity, retry: false, staleTime: Infinity },
      },
    });
    clearQueries = () => queryClient.clear();
    await TestBed.configureTestingModule({
      imports: [ProfileDiscountsComponent],
      providers: [
        provideTanStackQuery(queryClient),
        { provide: TENANT_DATE_PIPE_TIMEZONE, useValue: 'Europe/Berlin' },
        {
          provide: ConfigService,
          useValue: { tenantSignal } satisfies Pick<
            ConfigService,
            'tenantSignal'
          >,
        },
        { provide: NotificationService, useValue: notifications },
        {
          provide: APP_RPC_CLIENT,
          useValue: {
            discounts: {
              deleteMyCard: {
                mutationOptions: (): ReturnType<
                  Client['discounts']['deleteMyCard']['mutationOptions']
                > => ({ mutationFn: remove }),
              },
              getMyCards: {
                queryOptions: (): ReturnType<
                  Client['discounts']['getMyCards']['queryOptions']
                > => ({ queryFn: readCards, queryKey }),
              },
              refreshMyCard: {
                mutationOptions: (): ReturnType<
                  Client['discounts']['refreshMyCard']['mutationOptions']
                > => ({ mutationFn: check }),
              },
              upsertMyCard: {
                mutationOptions: (): ReturnType<
                  Client['discounts']['upsertMyCard']['mutationOptions']
                > => ({ mutationFn: save }),
              },
            },
            queryFilter: createRpcQueryFilter,
          },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ProfileDiscountsComponent);
    submitOperation
      .mockReset()
      .mockImplementation(
        fixture.componentInstance['saveEsnCard'].bind(
          fixture.componentInstance,
        ),
      );
    fixture.componentInstance['saveEsnCard'] = submitOperation;
    destroyFixture = () => fixture.destroy();
    const element: unknown = fixture.nativeElement;
    if (!(element instanceof HTMLElement))
      throw new Error('Expected the discounts component element');
    root = element;
    fixture.detectChanges();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(root.textContent).toContain(card.identifier);
    });
    await enterIdentifier();
  });

  afterEach(async () => {
    const failures: unknown[] = [];
    for (const result of await Promise.all(operations)) {
      if (result.status === 'rejected') failures.push(result.reason);
    }
    for (const cleanup of [
      () => destroyFixture?.(),
      () => clearQueries?.(),
      () => TestBed.resetTestingModule(),
      () => vi.restoreAllMocks(),
    ]) {
      try {
        cleanup();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0)
      throw new AggregateError(
        failures,
        'Discount component operations and cleanup failed',
      );
  });

  for (const action of ['save', 'refresh', 'remove'] as const) {
    it(`awaits the confirmed ${action} and current card read before showing success`, async () => {
      const invalidation = vi.spyOn(queryClient, 'invalidateQueries');
      await start(action);
      fixture.detectChanges();
      expectOneMutation(action);
      expect(readCards).toHaveBeenCalledTimes(2);
      expect(invalidation).toHaveBeenCalledExactlyOnceWith(
        createRpcQueryFilter(['discounts', 'getMyCards']),
        { throwOnError: true },
      );
      expect(notifications.showSuccess).toHaveBeenCalledExactlyOnceWith(
        action === 'save'
          ? 'ESNcard saved'
          : action === 'remove'
            ? 'ESNcard removed'
            : 'ESNcard checked',
      );
      expect(input().value).toBe(action === 'save' ? '' : 'NEWCARD12');
      expect(input().disabled).toBe(false);
      expect(button('Check again').disabled).toBe(false);
      expect(button('Remove').disabled).toBe(false);
      expect(queryClient.getMutationCache().getAll()[0]?.state.status).toBe(
        'success',
      );
    });

    it(`retains entries after a simulated committed ${action} loses its mutation response`, async () => {
      let simulatedCommit = false;
      const failure = new Error('Simulated lost response after commit');
      const loseResponse = async () => {
        simulatedCommit = true;
        throw failure;
      };
      switch (action) {
        case 'refresh': {
          check.mockImplementation(loseResponse);
          break;
        }
        case 'remove': {
          {
            remove.mockImplementation(loseResponse);
            // No default
          }
          break;
        }
        case 'save': {
          save.mockImplementation(loseResponse);
          break;
        }
      }
      const invalidation = vi.spyOn(queryClient, 'invalidateQueries');
      await start(action);
      await message(esnCardMutationErrorMessage(action, failure));
      expect(simulatedCommit).toBe(true);
      expectOneMutation(action);
      expect(input().value).toBe('NEWCARD12');
      expect(input().disabled).toBe(true);
      expect(submitButton().disabled).toBe(true);
      expect(button('Check again').disabled).toBe(true);
      expect(button('Remove').disabled).toBe(true);
      expect(button('Try again').disabled).toBe(false);
      await start('save');
      await start('refresh');
      await start('remove');
      expectOneMutation(action);
      expect(invalidation).not.toHaveBeenCalled();
      expect(readCards).toHaveBeenCalledOnce();
      expect(notifications.showSuccess).not.toHaveBeenCalled();
      expect(root.textContent).not.toContain(failure.message);
      expect(queryClient.getMutationCache().getAll()[0]?.state.status).toBe(
        'error',
      );
      await own(fixture.componentInstance['readSavedCards']());
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(input().disabled).toBe(false);
        expect(root.textContent).not.toContain(
          esnCardMutationErrorMessage(action, failure),
        );
      });
      expect(input().value).toBe('NEWCARD12');
      expect(readCards).toHaveBeenCalledTimes(2);
      expectOneMutation(action);
      expect(notifications.showSuccess).not.toHaveBeenCalled();
    });

    it(`blocks further writes after a confirmed ${action} until an explicit successful card read`, async () => {
      readCards.mockRejectedValueOnce(new Error('Card read failed'));
      await start(action);
      await message(confirmedMessage(action));
      expectOneMutation(action);
      expect(input().value).toBe('NEWCARD12');
      expect(input().disabled).toBe(true);
      expect(submitButton().disabled).toBe(true);
      expect(notifications.showSuccess).not.toHaveBeenCalled();
      expect(queryClient.getMutationCache().getAll()[0]?.state.status).toBe(
        'success',
      );
      await start('save');
      await start('refresh');
      await start('remove');
      expectOneMutation(action);
      readCards.mockRejectedValueOnce(new Error('Explicit read still failed'));
      await own(fixture.componentInstance['readSavedCards']());
      await message(confirmedMessage(action));
      expect(input().disabled).toBe(true);
      expectOneMutation(action);
      expect(button('Try again').disabled).toBe(false);
      await own(fixture.componentInstance['readSavedCards']());
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(input().disabled).toBe(false);
        expect(root.textContent).not.toContain(confirmedMessage(action));
      });
      expectOneMutation(action);
      expect(readCards).toHaveBeenCalledTimes(4);
      expect(notifications.showSuccess).toHaveBeenCalledOnce();
      expect(input().value).toBe(action === 'save' ? '' : 'NEWCARD12');
    });
  }

  it.each([
    new RpcInternalServerError({ message: 'Private upstream detail' }),
    new RpcBadRequestError({ message: 'Provider rejected this card' }),
  ])(
    'preserves the existing expected denial or uncertain save guidance',
    async (error) => {
      save.mockRejectedValue(error);
      await start('save');
      await message(esnCardMutationErrorMessage('save', error));
      expectOneMutation('save');
      expect(input().value).toBe('NEWCARD12');
      expect(input().disabled).toBe(error._tag === 'RpcInternalServerError');
      if (error._tag === 'RpcInternalServerError') {
        expect(submitButton().disabled).toBe(true);
        expect(button('Try again').disabled).toBe(false);
      }
      expect(readCards).toHaveBeenCalledOnce();
      expect(notifications.showSuccess).not.toHaveBeenCalled();
      expect(root.textContent).not.toContain(error.message);
    },
  );

  it('requires an explicit current read after unconfirmed removal through failed and offline recovery', async () => {
    const originalOnlineState = onlineManager.isOnline();
    let releaseRecoveryRead: (() => void) | undefined;
    const failures: unknown[] = [];
    const readOperation = vi.fn<() => Promise<void>>();
    readOperation.mockImplementation(
      fixture.componentInstance['readSavedCards'].bind(
        fixture.componentInstance,
      ),
    );
    fixture.componentInstance['readSavedCards'] = readOperation;
    try {
      const lostResponse = new Error('Private lost removal response');
      remove.mockRejectedValueOnce(lostResponse);
      await start('remove');
      await message(esnCardMutationErrorMessage('remove', lostResponse));
      expectOneMutation('remove');
      expect(readCards).toHaveBeenCalledOnce();
      expect(input().disabled).toBe(true);
      expect(root.textContent).toContain(card.identifier);

      readCards.mockRejectedValueOnce(
        new Error('Private recovery read failure'),
      );
      await own(fixture.componentInstance['readSavedCards']());
      await message('Your current cards could not be loaded.');
      expect(readCards).toHaveBeenCalledTimes(2);
      expect(input().disabled).toBe(true);
      expect(submitButton().disabled).toBe(true);
      expect(button('Try again').disabled).toBe(false);
      expect(root.textContent).not.toContain('Private recovery read failure');

      onlineManager.setOnline(false);
      await own(fixture.componentInstance['readSavedCards']());
      const pausedRead = queryClient.getQueryCache().find({
        exact: true,
        queryKey,
      })?.promise;
      if (!pausedRead) throw new Error('Expected the owned paused card read');
      const observedPausedRead = own(
        pausedRead.then(
          () => {
            // Observe the resumed read without treating it as explicit recovery.
          },
          (error: unknown) => {
            if (!isCancelledError(error)) throw error;
          },
        ),
      );
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(queryClient.getQueryState(queryKey)?.fetchStatus).toBe('paused');
        expect(fixture.componentInstance['cardReadPending']()).toBe(false);
        expect(input().disabled).toBe(true);
        expect(submitButton().disabled).toBe(true);
      });
      expect(readCards).toHaveBeenCalledTimes(2);
      await start('save');
      await start('refresh');
      await start('remove');
      expectOneMutation('remove');

      // Angular's ES2022 library does not expose Promise.withResolvers.

      const recoveryRead = new Promise<void>((resolve) => {
        releaseRecoveryRead = () => resolve(undefined);
      });
      own(recoveryRead);
      readCards.mockImplementationOnce(async () => {
        await recoveryRead;
        return [];
      });
      onlineManager.setOnline(true);
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(queryClient.getQueryState(queryKey)?.fetchStatus).toBe(
          'fetching',
        );
        expect(readCards).toHaveBeenCalledTimes(3);
        expect(input().disabled).toBe(true);
      });
      releaseRecoveryRead?.();
      await observedPausedRead;
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(queryClient.getQueryState(queryKey)?.fetchStatus).toBe('idle');
        expect(queryClient.getQueryState(queryKey)?.status).toBe('success');
        expect(root.textContent).toContain('No discount cards added.');
        expect(input().disabled).toBe(true);
      });
      // A background read does not silently complete the user's recovery action.
      expect(input().value).toBe('NEWCARD12');
      expect(notifications.showSuccess).not.toHaveBeenCalled();
      expect(button('Try again').disabled).toBe(false);
      readCards.mockResolvedValue([]);
      button('Try again').click();
      const result = readOperation.mock.results.at(-1);
      if (result?.type !== 'return')
        throw new Error('Expected the actual read-only recovery operation');
      await own(result.value);
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(input().disabled).toBe(false);
        expect(submitButton().disabled).toBe(false);
        expect(root.textContent).toContain('No discount cards added.');
        expect(root.textContent).not.toContain('could not be loaded');
        expect(root.textContent).not.toContain("couldn't confirm");
      });
      expect(input().value).toBe('NEWCARD12');
      expect(readCards).toHaveBeenCalledTimes(4);
      expectOneMutation('remove');
      expect(notifications.showSuccess).not.toHaveBeenCalled();
      expect(root.textContent).not.toContain(lostResponse.message);
    } catch (error) {
      failures.push(error);
    } finally {
      for (const cleanup of [
        () => releaseRecoveryRead?.(),
        () => queryClient.cancelQueries({ exact: true, queryKey }),
        () => fixture.destroy(),
        () => queryClient.clear(),
        () => onlineManager.setOnline(originalOnlineState),
      ]) {
        try {
          await cleanup();
        } catch (error) {
          failures.push(error);
        }
      }
    }
    if (failures.length > 0)
      throw new AggregateError(failures, 'Unconfirmed card recovery failed');
  });

  it('drains a real active sibling read after the first read rejects and blocks duplicate writes', async () => {
    let releaseRead: (() => void) | undefined;
    // Angular's ES2022 library does not expose Promise.withResolvers.

    const heldRead = new Promise<undefined>((resolve) => {
      releaseRead = () => resolve(undefined);
    });
    const siblingKey = createRpcQueryKey<{ view: string }>(
      ['discounts', 'getMyCards'],
      { input: { view: 'related' }, type: 'query' },
    );
    const siblingRead = vi.fn(async () => {
      await heldRead;
      return [card];
    });
    queryClient.setQueryData(siblingKey, [card]);
    const observer = new QueryObserver(queryClient, {
      queryFn: siblingRead,
      queryKey: siblingKey,
      retry: false,
      staleTime: Infinity,
    });
    const unsubscribe = observer.subscribe(() => {
      // Keep the actual sibling query active until the owned cleanup.
    });
    const invalidation = vi.spyOn(queryClient, 'invalidateQueries');
    readCards.mockRejectedValueOnce(new Error('Primary card read failed'));
    let operation: Promise<void> | undefined;
    try {
      operation = start('save');
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(queryClient.getQueryState(queryKey)?.status).toBe('error');
        expect(queryClient.getQueryState(siblingKey)?.fetchStatus).toBe(
          'fetching',
        );
        expect(queryClient.getMutationCache().getAll()[0]?.state.status).toBe(
          'success',
        );
        expect(input().disabled).toBe(true);
        expect(submitButton().disabled).toBe(true);
        expect(root.querySelector('[role="status"]')?.textContent).toContain(
          'Updating your ESNcard information',
        );
      });
      await start('save');
      await start('refresh');
      await start('remove');
      await own(fixture.componentInstance['readSavedCards']());
      expectOneMutation('save');
      expect(siblingRead).toHaveBeenCalledOnce();
      expect(invalidation).toHaveBeenCalledOnce();
      expect(notifications.showSuccess).not.toHaveBeenCalled();
      expect(input().value).toBe('NEWCARD12');
      releaseRead?.();
      await operation;
      await message(confirmedMessage('save'));
      expect(input().disabled).toBe(true);
      expectOneMutation('save');
    } finally {
      releaseRead?.();
      try {
        await operation;
      } finally {
        unsubscribe();
      }
    }
  });

  for (const action of ['save', 'refresh'] as const) {
    for (const scenario of [
      {
        error: new DiscountCardChangedError({
          message: 'Private changed-card detail',
        }),
        label: 'a changed-card conflict',
        locked: false,
        reload: true,
      },
      {
        error: new RpcBadRequestError({
          message: 'Private provider detail',
          reason: 'provider-network',
        }),
        label: 'a provider transport rejection',
        locked: false,
        reload: false,
      },
      {
        error: new RpcInternalServerError({ message: 'Private server detail' }),
        label: 'an unconfirmed server failure',
        locked: true,
        reload: false,
      },
    ]) {
      it(`preserves the ${action} draft and reconciles ${scenario.label}`, async () => {
        const replacement = { ...card, identifier: 'CURRENT34' };
        readCards.mockResolvedValue([replacement]);
        if (action === 'save') save.mockRejectedValueOnce(scenario.error);
        else check.mockRejectedValueOnce(scenario.error);

        await start(action);
        await message(
          scenario.reload
            ? 'Review your current card before checking again.'
            : esnCardMutationErrorMessage(action, scenario.error),
        );
        expectOneMutation(action);
        expect(readCards).toHaveBeenCalledTimes(scenario.reload ? 2 : 1);
        const expectedCard = scenario.reload ? replacement : card;
        await vi.waitFor(() => {
          fixture.detectChanges();
          expect(queryClient.getQueryData(queryKey)).toEqual([expectedCard]);
          expect(root.textContent).toContain(expectedCard.identifier);
          expect(root.textContent).not.toContain(
            scenario.reload ? card.identifier : replacement.identifier,
          );
        });
        expect(root.textContent).not.toContain(scenario.error.message);
        expect(input().value).toBe('NEWCARD12');
        expect(input().disabled).toBe(scenario.locked);
        expect(submitButton().disabled).toBe(scenario.locked);
        expect(button('Check again').disabled).toBe(scenario.locked);
        expect(button('Remove').disabled).toBe(scenario.locked);
        expect(notifications.showSuccess).not.toHaveBeenCalled();
        if (scenario.locked) expect(button('Try again').disabled).toBe(false);
      });
    }
  }

  for (const changed of [true, false]) {
    it(`keeps the action locked through the existing ${changed ? 'changed' : 'not-found'} card reconciliation`, async () => {
      let releaseRead: (() => void) | undefined;
      // Angular's ES2022 library does not expose Promise.withResolvers.

      const heldRead = new Promise<undefined>((resolve) => {
        releaseRead = () => resolve(undefined);
      });
      check.mockRejectedValue(
        changed
          ? new DiscountCardChangedError({ message: 'Concurrent card change' })
          : new DiscountCardNotFoundError({ message: 'Card already removed' }),
      );
      readCards.mockImplementationOnce(async () => {
        await heldRead;
        return [card];
      });
      let operation: Promise<void> | undefined;
      try {
        operation = start('refresh');
        await vi.waitFor(() => {
          fixture.detectChanges();
          expect(readCards).toHaveBeenCalledTimes(2);
          expect(input().disabled).toBe(true);
          expect(button('Checking…').disabled).toBe(true);
          expect(button('Remove').disabled).toBe(true);
        });
        await start('save');
        await start('remove');
        expectOneMutation('refresh');
        releaseRead?.();
        await operation;
        await message(
          changed
            ? 'Your saved ESNcard changed while it was being checked. The old check was not saved. Review your current card before checking again.'
            : 'This ESNcard was already removed. Your card list is now up to date.',
        );
        expect(input().value).toBe('NEWCARD12');
        expect(input().disabled).toBe(false);
        expect(notifications.showSuccess).not.toHaveBeenCalled();
      } finally {
        releaseRead?.();
        await operation;
      }
    });
  }

  it('retains invalid input without invoking a mutation', async () => {
    input().value = 'short';
    input().dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
    await start('save');
    fixture.detectChanges();
    expect(input().value).toBe('short');
    expect(submitButton().disabled).toBe(true);
    expect(save).not.toHaveBeenCalled();
    expect(check).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(readCards).toHaveBeenCalledOnce();
  });

  it('preserves the disabled-provider boundary for reads and every mutation', async () => {
    tenantSignal.set(
      new ClientTenantConfig({
        ...tenant,
        discountProviders: { esnCard: { config: {}, status: 'disabled' } },
      }),
    );
    fixture.detectChanges();
    await start('save');
    await start('refresh');
    await start('remove');
    await own(fixture.componentInstance['readSavedCards']());
    expect(root.textContent).toContain(
      'Discount cards are not enabled for this organization.',
    );
    expect(root.querySelector('form')).toBeNull();
    expect(save).not.toHaveBeenCalled();
    expect(check).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(readCards).toHaveBeenCalledOnce();
  });
});
