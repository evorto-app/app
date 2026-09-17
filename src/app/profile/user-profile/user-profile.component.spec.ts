import '@angular/compiler';
import { OverlayContainer } from '@angular/cdk/overlay';
import { ChangeDetectorRef, getDebugNode, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormField } from '@angular/forms/signals';
import {
  MAT_DIALOG_DEFAULT_OPTIONS,
  MatDialog,
  MatDialogRef,
} from '@angular/material/dialog';
import { provideRouter } from '@angular/router';
import {
  createRpcPathKey,
  createRpcQueryFilter,
  createRpcQueryKey,
} from '@heddendorp/effect-angular-query';
import {
  RpcBadRequestError,
  RpcInternalServerError,
  RpcUnauthorizedError,
} from '@shared/errors/rpc-errors';
import { ClientTenantConfig } from '@shared/rpc-contracts/app-rpcs/config.rpcs';
import {
  provideTanStackQuery,
  QueryClient,
  QueryObserver,
} from '@tanstack/angular-query-experimental';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfigService } from '../../core/config.service';
import { APP_RPC_CLIENT, AppRpc } from '../../core/effect-rpc-angular-client';
import { NotificationService } from '../../core/notification.service';
import {
  EditProfileDialogComponent,
  EditProfileDialogResult,
} from './edit-profile-dialog.component';
import {
  isBrowsingOutsideHomeTenant,
  profileReimbursementReadiness,
  profileTransferClaimPath,
  profileUpdateErrorMessage,
  profileUserAfterEdit,
  UserProfileComponent,
} from './user-profile.component';

describe('profile overview', () => {
  it('links the transfer claim action to the manual-code entry page', () => {
    expect(profileTransferClaimPath).toBe('/registration-transfers');
  });

  it('warns only when the current tenant differs from an explicit home tenant', () => {
    expect(isBrowsingOutsideHomeTenant('tenant-home', 'tenant-away')).toBe(
      true,
    );
    expect(isBrowsingOutsideHomeTenant('tenant-home', 'tenant-home')).toBe(
      false,
    );
    expect(isBrowsingOutsideHomeTenant(undefined, 'tenant-away')).toBe(false);
  });

  it('merges saved profile fields into the visible profile cache', () => {
    expect(
      profileUserAfterEdit(
        {
          communicationEmail: 'old@example.com',
          email: 'login@example.com',
          firstName: 'Old',
          iban: null,
          id: 'user-1',
          lastName: 'Name',
          paypalEmail: null,
        },
        {
          communicationEmail: 'new@example.com',
          firstName: 'New',
          iban: 'DE89370400440532013000',
          lastName: 'Person',
          paypalEmail: null,
        },
      ),
    ).toEqual({
      communicationEmail: 'new@example.com',
      email: 'login@example.com',
      firstName: 'New',
      iban: 'DE89370400440532013000',
      id: 'user-1',
      lastName: 'Person',
      paypalEmail: null,
    });
  });

  it('summarizes reimbursement readiness without exposing bank details', () => {
    expect(
      profileReimbursementReadiness({
        iban: 'DE89370400440532013000',
        paypalEmail: 'member@example.com',
      }),
    ).toBe('IBAN and PayPal details added.');
    expect(
      profileReimbursementReadiness({
        iban: 'DE89370400440532013000',
      }),
    ).toBe('IBAN added.');
    expect(
      profileReimbursementReadiness({
        paypalEmail: 'member@example.com',
      }),
    ).toBe('PayPal account added.');
    expect(profileReimbursementReadiness({})).toBe(
      'No reimbursement details added.',
    );
  });

  it('shows profile corrections without exposing internal failures', () => {
    expect(
      profileUpdateErrorMessage({
        _tag: 'RpcBadRequestError',
        message: 'Enter a valid IBAN.',
      }),
    ).toBe('Enter a valid IBAN.');
    expect(
      profileUpdateErrorMessage({
        _tag: 'RpcInternalServerError',
        message: 'database failed',
      }),
    ).toBe(
      "We couldn't confirm whether your profile was saved. Open your profile in another tab to check before trying again. Your entries are still here.",
    );
  });
});

describe('UserProfileComponent save outcomes', () => {
  type Client = ReturnType<typeof AppRpc.injectClient>;
  type UpdateOptions = ReturnType<
    Client['users']['updateProfile']['mutationOptions']
  >;
  type UpdateMutation = NonNullable<UpdateOptions['mutationFn']>;
  type UpdateInput = Parameters<UpdateMutation>[0];
  type SelfOptions = ReturnType<Client['users']['self']['queryOptions']>;
  type MaybeSelfOptions = ReturnType<
    Client['users']['maybeSelf']['queryOptions']
  >;
  type ReceiptOptions = ReturnType<
    Client['finance']['receipts']['refundableGroupedByRecipient']['queryOptions']
  >;
  type SelfQuery = Extract<
    NonNullable<SelfOptions['queryFn']>,
    (...args: never[]) => unknown
  >;
  type MaybeSelfQuery = Extract<
    NonNullable<MaybeSelfOptions['queryFn']>,
    (...args: never[]) => unknown
  >;
  type ReceiptQuery = Extract<
    NonNullable<ReceiptOptions['queryFn']>,
    (...args: never[]) => unknown
  >;
  type ProfileUser = Awaited<ReturnType<SelfQuery>>;
  type Receipts = Awaited<ReturnType<ReceiptQuery>>;
  const originalUser: ProfileUser = {
    auth0Id: 'auth0|profile-outcome',
    communicationEmail: 'original@example.org',
    email: 'signin@example.org',
    firstName: 'Original',
    homeTenantId: undefined,
    homeTenantName: undefined,
    iban: undefined,
    id: 'profile-outcome-user',
    lastName: 'Member',
    paypalEmail: undefined,
    permissions: [],
    roleIds: [],
  };
  const entered = {
    communicationEmail: 'Updates@Example.ORG',
    firstName: ' Alice ',
    iban: ' de89 3704 0044 0532 0130 00 ',
    lastName: ' Changed ',
    paypalEmail: 'Refunds@Example.ORG',
  };
  const payload = {
    communicationEmail: 'updates@example.org',
    firstName: 'Alice',
    iban: 'DE89370400440532013000',
    lastName: 'Changed',
    paypalEmail: 'refunds@example.org',
  } satisfies UpdateInput;
  const savedUser: ProfileUser = { ...originalUser, ...payload };
  const unknownMessage =
    "We couldn't confirm whether your profile was saved. Open your profile in another tab to check before trying again. Your entries are still here.";
  const savedMessage =
    'Your profile was saved, but the latest information could not be loaded. Close this dialog and load your profile again to see the saved details.';
  const unauthorizedMessage =
    'Your profile was not changed. Sign in again and complete your organization setup before saving. Your entries are still here.';
  const selfKey = createRpcQueryKey<undefined>(['users', 'self'], {
    keyPrefix: 'rpc',
    type: 'query',
  });
  const maybeSelfKey = createRpcQueryKey<undefined>(['users', 'maybeSelf'], {
    keyPrefix: 'rpc',
    type: 'query',
  });
  const receiptPath = [
    'finance',
    'receipts',
    'refundableGroupedByRecipient',
  ] as const;
  const receiptKey = createRpcQueryKey<undefined>(receiptPath, {
    keyPrefix: 'rpc',
    type: 'query',
  });
  const updateKey = createRpcQueryKey<undefined>(['users', 'updateProfile'], {
    keyPrefix: 'rpc',
    type: 'mutation',
  });
  const updateMeta = { rpc: { path: ['users', 'updateProfile'] } };
  const homeKey = createRpcQueryKey<undefined>(['users', 'setHomeTenant'], {
    keyPrefix: 'rpc',
    type: 'mutation',
  });
  const homeMeta = { rpc: { path: ['users', 'setHomeTenant'] } };
  const pathKey: Client['pathKey'] = (segments, options = {}) =>
    createRpcPathKey(segments, { keyPrefix: 'rpc', ...options });
  const queryFilter: Client['queryFilter'] = (segments, options = {}) =>
    createRpcQueryFilter(segments, { keyPrefix: 'rpc', ...options });
  const update = vi.fn<UpdateMutation>();
  const setHome =
    vi.fn<
      NonNullable<
        ReturnType<
          Client['users']['setHomeTenant']['mutationOptions']
        >['mutationFn']
      >
    >();
  const findSelf = vi.fn<SelfQuery>();
  const findMaybeSelf = vi.fn<MaybeSelfQuery>();
  const findReceipts = vi.fn<ReceiptQuery>();
  const successNotice = vi.fn<(message: string) => void>();
  const errorNotice = vi.fn<(message: string) => void>();
  const openDialogOperation =
    vi.fn<UserProfileComponent['openEditProfileDialog']>();
  let currentUser = originalUser;
  let queryClient: QueryClient;
  let dialog: MatDialog;
  let fixture: ComponentFixture<UserProfileComponent>;
  let root: HTMLElement;
  let overlay: HTMLElement;
  let cleanupQueryClient: QueryClient | undefined;
  let cleanupDialog: MatDialog | undefined;
  let cleanupFixture: ComponentFixture<UserProfileComponent> | undefined;
  let operations: Promise<PromiseSettledResult<void>>[] = [];
  let dialogOperations: Promise<PromiseSettledResult<void>>[] = [];
  let dialogSettlements: PromiseSettledResult<void>[] = [];
  let releaseGates: (() => void)[] = [];
  let unsubscribeObservers: (() => void)[] = [];

  const selfOptions = (): SelfOptions => ({
    queryFn: findSelf,
    queryKey: selfKey,
  });
  const maybeSelfOptions = (): MaybeSelfOptions => ({
    queryFn: findMaybeSelf,
    queryKey: maybeSelfKey,
  });
  const receiptOptions = (): ReceiptOptions => ({
    queryFn: findReceipts,
    queryKey: receiptKey,
  });
  const observe = (operation: Promise<void>) => {
    operations.push(
      operation.then<PromiseSettledResult<void>, PromiseSettledResult<void>>(
        () => ({ status: 'fulfilled', value: undefined }),
        (error) => ({ reason: error, status: 'rejected' }),
      ),
    );
    return operation;
  };
  const gate = <T>(fallback: T) => {
    let release: (value: T) => void = () => {
      throw new Error('Expected the held operation to be initialized.');
    };
    // Signal Forms test compilation targets ES2022, so Promise.withResolvers is unavailable.
    // eslint-disable-next-line unicorn/prefer-promise-with-resolvers
    const promise = new Promise<T>((resolve) => {
      release = resolve;
    });
    observe(
      promise.then(() => {
        // Track settlement without changing the gated result.
      }),
    );
    releaseGates.push(() => release(fallback));
    return { promise, release };
  };
  const button = (container: HTMLElement, title: string) => {
    const result = [
      ...container.querySelectorAll<HTMLButtonElement>('button'),
    ].find((item) => item.textContent?.trim() === title);
    if (!result) throw new Error(`Expected the ${title} button.`);
    return result;
  };
  const mutationState = () =>
    queryClient.getMutationCache().getAll()[0]?.state.status;
  const expectSingleMutation = () => {
    expect(update).toHaveBeenCalledOnce();
    expect(update.mock.calls[0]).toEqual([
      payload,
      { client: queryClient, meta: updateMeta, mutationKey: updateKey },
    ]);
    expect(queryClient.getMutationCache().getAll()).toHaveLength(1);
  };
  const expectCanonicalProfileCache = () => {
    expect(queryClient.getQueryData(selfKey)).toEqual(savedUser);
    expect(queryClient.getQueryData(maybeSelfKey)).toEqual(savedUser);
    expect(
      queryClient
        .getQueryCache()
        .find({ exact: true, queryKey: pathKey(['users', 'self']) }),
    ).toBeUndefined();
    expect(
      queryClient
        .getQueryCache()
        .find({ exact: true, queryKey: pathKey(['users', 'maybeSelf']) }),
    ).toBeUndefined();
  };
  const expectRefreshes = () => {
    expect(findSelf).toHaveBeenCalledTimes(2);
    expect(findMaybeSelf).toHaveBeenCalledTimes(2);
    expect(findReceipts).toHaveBeenCalledTimes(2);
    expect(
      queryClient.getQueryCache().findAll(queryFilter(receiptPath)),
    ).toHaveLength(1);
  };
  const openEditor = async () => {
    button(root, 'Edit profile').click();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(dialog.openDialogs).toHaveLength(1);
      expect(overlay.querySelector('app-edit-profile-dialog')).not.toBeNull();
    });
    const element = overlay.querySelector<HTMLElement>(
      'app-edit-profile-dialog',
    );
    if (!element) throw new Error('Expected the actual edit-profile dialog.');
    const debug = getDebugNode(element);
    if (!debug) throw new Error('Expected the profile dialog debug node.');
    const component = debug.injector.get(EditProfileDialogComponent);
    const dialogRef = debug.injector.get(
      MatDialogRef<EditProfileDialogComponent, EditProfileDialogResult>,
    );
    const changeDetector = debug.injector.get(ChangeDetectorRef);
    const submit = vi.spyOn(component, 'onSubmit');
    const detect = () => {
      fixture.detectChanges();
      changeDetector.detectChanges();
    };
    const field = (label: string) => {
      const group = [...element.querySelectorAll('mat-form-field')].find(
        (item) =>
          item.querySelector('mat-label')?.textContent?.trim() === label,
      );
      const input = group?.querySelector<HTMLInputElement>('input');
      if (!input) throw new Error(`Expected the ${label} field.`);
      const inputDebug = getDebugNode(input);
      if (!inputDebug)
        throw new Error(`Expected the ${label} FormField binding.`);
      return { binding: inputDebug.injector.get(FormField), input };
    };
    const fields = {
      communicationEmail: field('Email for updates'),
      firstName: field('First name'),
      iban: field('IBAN (for reimbursements)'),
      lastName: field('Last name'),
      paypalEmail: field('PayPal email (for reimbursements)'),
    };
    for (const name of [
      'communicationEmail',
      'firstName',
      'iban',
      'lastName',
      'paypalEmail',
    ] as const) {
      fields[name].input.value = entered[name];
      fields[name].input.dispatchEvent(new Event('input', { bubbles: true }));
      fields[name].input.dispatchEvent(new Event('blur'));
    }
    const expectValues = () => {
      const values = Object.fromEntries(
        Object.entries(fields).map(([name, value]) => [
          name,
          value.binding.state().value(),
        ]),
      );
      expect(JSON.stringify(values)).toBe(JSON.stringify(entered));
      for (const name of [
        'communicationEmail',
        'firstName',
        'iban',
        'lastName',
        'paypalEmail',
      ] as const) {
        expect(fields[name].input.value).toBe(entered[name]);
      }
    };
    await vi.waitFor(() => {
      detect();
      expect(button(element, 'Save').disabled).toBe(false);
      expectValues();
    });
    const submitForm = () => {
      const form = element.querySelector('form');
      if (!form) throw new Error('Expected the actual profile form.');
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      );
      const result = submit.mock.results.at(-1);
      if (result?.type !== 'return')
        throw new Error('Expected the real profile submit operation.');
      return observe(result.value);
    };
    const expectLocked = () => {
      expectValues();
      for (const value of Object.values(fields)) {
        expect(value.input.disabled).toBe(true);
        expect(value.binding.state().disabled()).toBe(true);
      }
      expect(button(element, 'Saving…').disabled).toBe(true);
      expect(button(element, 'Cancel').disabled).toBe(true);
      expect(dialogRef.disableClose).toBe(true);
      expect(button(root, 'Edit profile').disabled).toBe(true);
      expect(element.querySelector('[role="status"]')?.textContent).toContain(
        'Saving your profile and loading the latest information',
      );
      expect(element.querySelector('[role="alert"]')).toBeNull();
    };
    const expectMessage = async (message: string) => {
      await vi.waitFor(() => {
        detect();
        expect(element.querySelector('[role="alert"]')?.textContent).toContain(
          message,
        );
      });
      expectValues();
      expectSingleMutation();
    };
    return {
      component,
      detect,
      dialogRef,
      element,
      expectLocked,
      expectMessage,
      expectValues,
      fields,
      submitForm,
    };
  };

  beforeEach(async () => {
    cleanupDialog = undefined;
    cleanupQueryClient = undefined;
    cleanupFixture = undefined;
    operations = [];
    dialogOperations = [];
    dialogSettlements = [];
    releaseGates = [];
    unsubscribeObservers = [];
    currentUser = originalUser;
    update.mockReset().mockImplementation(async () => {
      currentUser = savedUser;
    });
    setHome.mockReset();
    findSelf.mockReset().mockImplementation(async () => currentUser);
    findMaybeSelf.mockReset().mockImplementation(async () => currentUser);
    findReceipts.mockReset().mockResolvedValue([]);
    successNotice.mockReset();
    errorNotice.mockReset();
    queryClient = new QueryClient({
      defaultOptions: {
        mutations: { gcTime: 0, retry: false },
        queries: { gcTime: 0, retry: false, staleTime: Infinity },
      },
    });
    cleanupQueryClient = queryClient;
    await TestBed.configureTestingModule({
      imports: [UserProfileComponent],
      providers: [
        provideRouter([]),
        provideTanStackQuery(queryClient),
        {
          provide: MAT_DIALOG_DEFAULT_OPTIONS,
          useValue: {
            disableClose: false,
            enterAnimationDuration: 0,
            exitAnimationDuration: 0,
          },
        },
        {
          provide: ConfigService,
          useValue: {
            tenantSignal:
              signal<ReturnType<ConfigService['tenantSignal']>>(null),
          } satisfies Pick<ConfigService, 'tenantSignal'>,
        },
        {
          provide: NotificationService,
          useValue: {
            showError: errorNotice,
            showSuccess: successNotice,
          } satisfies Pick<NotificationService, 'showError' | 'showSuccess'>,
        },
        {
          provide: APP_RPC_CLIENT,
          useValue: {
            pathKey,
            queryFilter,
            users: {
              maybeSelf: { queryOptions: maybeSelfOptions },
              self: { queryOptions: selfOptions },
              setHomeTenant: {
                mutationOptions: (): ReturnType<
                  Client['users']['setHomeTenant']['mutationOptions']
                > => ({
                  meta: homeMeta,
                  mutationFn: setHome,
                  mutationKey: homeKey,
                }),
              },
              updateProfile: {
                mutationOptions: (): UpdateOptions => ({
                  meta: updateMeta,
                  mutationFn: update,
                  mutationKey: updateKey,
                }),
              },
            },
          },
        },
      ],
    }).compileComponents();
    dialog = TestBed.inject(MatDialog);
    cleanupDialog = dialog;
    overlay = TestBed.inject(OverlayContainer).getContainerElement();
    fixture = TestBed.createComponent(UserProfileComponent);
    cleanupFixture = fixture;
    const openDialog = fixture.componentInstance['openEditProfileDialog'].bind(
      fixture.componentInstance,
    );
    openDialogOperation.mockReset().mockImplementation(() => {
      const operation = openDialog();
      const ownedSettlements = dialogSettlements;
      const record = (result: PromiseSettledResult<void>) => {
        ownedSettlements.push(result);
        return result;
      };
      dialogOperations.push(
        operation.then<PromiseSettledResult<void>, PromiseSettledResult<void>>(
          () => record({ status: 'fulfilled', value: undefined }),
          (error) => record({ reason: error, status: 'rejected' }),
        ),
      );
      return operation;
    });
    fixture.componentInstance['openEditProfileDialog'] = openDialogOperation;
    const nativeElement: unknown = fixture.nativeElement;
    if (!(nativeElement instanceof HTMLElement))
      throw new Error('Expected the actual profile component root.');
    root = nativeElement;
    const maybeSelfObserver = new QueryObserver(
      queryClient,
      maybeSelfOptions(),
    );
    unsubscribeObservers.push(
      maybeSelfObserver.subscribe(() => {
        // Keep this real query active for follow-up reads.
      }),
    );
    const receiptObserver = new QueryObserver(queryClient, receiptOptions());
    unsubscribeObservers.push(
      receiptObserver.subscribe(() => {
        // Keep this real query active for follow-up reads.
      }),
    );
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(button(root, 'Edit profile').disabled).toBe(false);
      expect(findSelf).toHaveBeenCalledOnce();
      expect(findMaybeSelf).toHaveBeenCalledOnce();
      expect(findReceipts).toHaveBeenCalledOnce();
      expect(queryClient.getQueryState(maybeSelfKey)?.status).toBe('success');
      expect(queryClient.getQueryState(receiptKey)?.status).toBe('success');
    });
  });

  afterEach(async () => {
    const failures: unknown[] = [];
    for (const release of releaseGates) {
      try {
        release();
      } catch (error) {
        failures.push(error);
      }
    }
    const settled = await Promise.all(operations);
    for (const result of settled) {
      if (result.status === 'rejected') failures.push(result.reason);
    }
    const ownedDialog = cleanupDialog;
    const ownedFixture = cleanupFixture;
    const ownedClient = cleanupQueryClient;
    cleanupDialog = undefined;
    cleanupFixture = undefined;
    cleanupQueryClient = undefined;
    for (const cleanup of [
      () => ownedDialog?.closeAll(),
      async () => {
        if (ownedDialog)
          await vi.waitFor(() =>
            expect(ownedDialog.openDialogs).toHaveLength(0),
          );
      },
      async () => {
        await ownedFixture?.whenStable();
      },
      ...unsubscribeObservers,
      () => TestBed.resetTestingModule(),
      () => ownedClient?.clear(),
      () => vi.restoreAllMocks(),
      async () => {
        await vi.waitFor(() =>
          expect(dialogSettlements).toHaveLength(dialogOperations.length),
        );
      },
    ]) {
      try {
        await cleanup();
      } catch (error) {
        failures.push(error);
      }
    }
    for (const result of dialogSettlements) {
      if (result.status === 'rejected') failures.push(result.reason);
    }
    if (failures.length > 0)
      throw new AggregateError(
        failures,
        'Profile operation or fixture cleanup failed',
        { cause: failures[0] },
      );
  });

  it.each([
    ['unknown', new Error('Private response lost after a simulated commit')],
    [
      'Internal',
      new RpcInternalServerError({
        message: 'Private internal failure after a simulated commit',
      }),
    ],
  ] as const)(
    'retains all five entries after an %s save outcome',
    async (_kind, error) => {
      update.mockImplementationOnce(async () => {
        currentUser = savedUser;
        throw error;
      });
      const editor = await openEditor();
      await editor.submitForm();
      await editor.expectMessage(unknownMessage);
      expect(mutationState()).toBe('error');
      expect(button(editor.element, 'Save').disabled).toBe(false);
      expect(button(editor.element, 'Cancel').disabled).toBe(false);
      expect(editor.element.textContent).not.toContain('Private');
      expect(findSelf).toHaveBeenCalledOnce();
      expect(findMaybeSelf).toHaveBeenCalledOnce();
      expect(findReceipts).toHaveBeenCalledOnce();
      expect(successNotice).not.toHaveBeenCalled();
    },
  );

  it.each([
    [
      new RpcBadRequestError({ message: 'Enter a valid IBAN.' }),
      'Enter a valid IBAN.',
    ],
    [
      new RpcUnauthorizedError({ message: 'Private session context' }),
      unauthorizedMessage,
    ],
  ] as const)(
    'retains all five entries after typed profile denial %#',
    async (error, message) => {
      update.mockRejectedValueOnce(error);
      const editor = await openEditor();
      await editor.submitForm();
      await editor.expectMessage(message);
      expect(mutationState()).toBe('error');
      expect(currentUser).toEqual(originalUser);
      expect(button(editor.element, 'Save').disabled).toBe(false);
      expect(button(editor.element, 'Cancel').disabled).toBe(false);
      expect(editor.dialogRef.disableClose).toBe(false);
      expect(editor.element.textContent).not.toContain('Private');
      expect(successNotice).not.toHaveBeenCalled();
    },
  );

  it('retains a confirmed save with Close only when actual profile refetches fail', async () => {
    const editor = await openEditor();
    findSelf.mockRejectedValueOnce(new Error('Self read failed'));
    findMaybeSelf.mockRejectedValueOnce(new Error('Maybe-self read failed'));
    await editor.submitForm();
    await editor.expectMessage(savedMessage);
    expect(mutationState()).toBe('success');
    expectCanonicalProfileCache();
    expectRefreshes();
    expect(queryClient.getQueryState(selfKey)?.status).toBe('error');
    expect(queryClient.getQueryState(maybeSelfKey)?.status).toBe('error');
    expect(
      [...editor.element.querySelectorAll('button')].map((item) =>
        item.textContent?.trim(),
      ),
    ).toEqual(['Close']);
    for (const value of Object.values(editor.fields))
      expect(value.input.disabled).toBe(true);
    expect(button(editor.element, 'Close').disabled).toBe(false);
    await editor.submitForm();
    editor.expectValues();
    expectSingleMutation();
    expectRefreshes();
    expect(successNotice).not.toHaveBeenCalled();
    button(editor.element, 'Close').click();
    await vi.waitFor(() => expect(dialog.openDialogs).toHaveLength(0));
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(root.querySelector('[role="alert"]')?.textContent).toContain(
        "We couldn't load your profile. Try again.",
      );
      expect(button(root, 'Try again').disabled).toBe(false);
    });

    findSelf.mockRejectedValueOnce(new Error('Profile recovery read failed'));
    button(root, 'Try again').click();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(findSelf).toHaveBeenCalledTimes(3);
      expect(queryClient.getQueryState(selfKey)?.fetchStatus).toBe('idle');
      expect(queryClient.getQueryState(selfKey)?.status).toBe('error');
      expect(button(root, 'Try again').disabled).toBe(false);
    });
    expect(root.querySelector('[role="alert"]')?.textContent).toContain(
      "We couldn't load your profile. Try again.",
    );
    expect(root.textContent).not.toContain('Profile recovery read failed');

    const recoveryRead = gate<ProfileUser>(savedUser);
    findSelf.mockImplementationOnce(() => recoveryRead.promise);
    button(root, 'Try again').click();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(findSelf).toHaveBeenCalledTimes(4);
      expect(queryClient.getQueryState(selfKey)?.fetchStatus).toBe('fetching');
      expect(button(root, 'Trying again…').disabled).toBe(true);
    });
    button(root, 'Trying again…').click();
    expect(findSelf).toHaveBeenCalledTimes(4);
    expectSingleMutation();
    expect(findMaybeSelf).toHaveBeenCalledTimes(2);
    expect(findReceipts).toHaveBeenCalledTimes(2);
    expect(dialog.openDialogs).toHaveLength(0);

    recoveryRead.release(savedUser);
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(queryClient.getQueryState(selfKey)?.status).toBe('success');
      expect(root.querySelector('[role="alert"]')).toBeNull();
      expect(root.textContent).toContain(savedUser.communicationEmail);
      expect(button(root, 'Edit profile').disabled).toBe(false);
    });
    expect(queryClient.getQueryData(selfKey)).toEqual(savedUser);
    expectSingleMutation();
    expect(setHome).not.toHaveBeenCalled();
    expect(successNotice).not.toHaveBeenCalled();
  });

  it('closes only after a confirmed save and all real profile and receipt reads finish', async () => {
    const editor = await openEditor();
    const selfRead = gate<ProfileUser>(savedUser);
    const receiptRead = gate<Receipts>([]);
    findSelf.mockImplementationOnce(() => selfRead.promise);
    findReceipts.mockImplementationOnce(() => receiptRead.promise);
    const operation = editor.submitForm();
    await vi.waitFor(() => {
      editor.detect();
      expect(mutationState()).toBe('success');
      expectRefreshes();
      editor.expectLocked();
    });
    expectCanonicalProfileCache();
    selfRead.release(savedUser);
    await vi.waitFor(() =>
      expect(queryClient.getQueryState(selfKey)?.fetchStatus).toBe('idle'),
    );
    editor.detect();
    expect(dialog.openDialogs).toHaveLength(1);
    expect(button(editor.element, 'Saving…').disabled).toBe(true);
    expect(successNotice).not.toHaveBeenCalled();
    receiptRead.release([]);
    await operation;
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(dialog.openDialogs).toHaveLength(0);
      expect(button(root, 'Edit profile').disabled).toBe(false);
    });
    expectSingleMutation();
    expectCanonicalProfileCache();
    expectRefreshes();
    expect(successNotice).toHaveBeenCalledExactlyOnceWith('Profile updated');
    expect(queryClient.getQueryState(receiptKey)?.fetchStatus).toBe('idle');
  });

  it('locks fields, Cancel, Escape, parent opens and duplicate submits through mutation and a held receipt sibling read', async () => {
    const editor = await openEditor();
    const write = gate<undefined>(undefined);
    const receiptRead = gate<Receipts>([]);
    update.mockImplementationOnce(async () => {
      await write.promise;
      currentUser = savedUser;
    });
    findMaybeSelf.mockRejectedValueOnce(
      new Error('The first profile sibling read failed'),
    );
    findReceipts.mockImplementationOnce(() => receiptRead.promise);
    const operation = editor.submitForm();
    await vi.waitFor(() => {
      editor.detect();
      expect(mutationState()).toBe('pending');
      editor.expectLocked();
    });
    await editor.submitForm();
    expectSingleMutation();
    expect(findSelf).toHaveBeenCalledOnce();
    write.release(undefined);
    await vi.waitFor(() => {
      editor.detect();
      expect(mutationState()).toBe('success');
      expect(queryClient.getQueryState(maybeSelfKey)?.status).toBe('error');
      expect(queryClient.getQueryState(receiptKey)?.fetchStatus).toBe(
        'fetching',
      );
      expectRefreshes();
      editor.expectLocked();
    });
    button(editor.element, 'Cancel').click();
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', {
        bubbles: true,
        code: 'Escape',
        key: 'Escape',
        keyCode: 27,
      }),
    );
    button(root, 'Edit profile').dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );
    expect(openDialogOperation).toHaveBeenCalledOnce();
    // The disabled Material button blocks its click; also verify the handler guard.
    await fixture.componentInstance['openEditProfileDialog']();
    expect(openDialogOperation).toHaveBeenCalledTimes(2);
    await editor.submitForm();
    editor.detect();
    expect(dialog.openDialogs).toHaveLength(1);
    editor.expectLocked();
    expectSingleMutation();
    expectRefreshes();
    expect(successNotice).not.toHaveBeenCalled();
    receiptRead.release([]);
    await operation;
    await editor.expectMessage(savedMessage);
    expect(editor.dialogRef.disableClose).toBe(false);
    expect(button(editor.element, 'Close').disabled).toBe(false);
    await editor.submitForm();
    expectSingleMutation();
    expectRefreshes();
  });
  it('updates the actual profile caches and visible home organization after one native home action', async () => {
    const priorUser: ProfileUser = {
      ...originalUser,
      communicationEmail: 'home-updates@example.org',
      firstName: 'Home',
      homeTenantId: 'tenant-original',
      homeTenantName: 'Original Organization',
      iban: 'DE89370400440532013000',
      lastName: 'Member',
      paypalEmail: 'home-refunds@example.org',
      permissions: ['templates:view'],
      roleIds: ['role-profile'],
    };
    const currentTenant = new ClientTenantConfig({
      cancellationDeadlineHoursBeforeStart: 24,
      currency: 'EUR',
      defaultLocation: undefined,
      discountProviders: { esnCard: { config: {}, status: 'disabled' } },
      domain: 'current.example.org',
      emailSenderEmail: undefined,
      emailSenderName: undefined,
      faviconUrl: undefined,
      id: 'tenant-current',
      legalNoticeText: undefined,
      legalNoticeUrl: undefined,
      logoUrl: undefined,
      maxActiveRegistrationsPerUser: 3,
      name: 'Current Organization',
      paymentsConfigured: true,
      privacyPolicyText: undefined,
      privacyPolicyUrl: undefined,
      receiptSettings: { allowOther: false, receiptCountries: ['DE'] },
      refundFeesOnCancellation: false,
      seoDescription: undefined,
      seoTitle: undefined,
      termsText: undefined,
      termsUrl: undefined,
      theme: 'evorto',
      timezone: 'Europe/Berlin',
      transferDeadlineHoursBeforeStart: 24,
    });
    currentUser = priorUser;
    queryClient.setQueryData(selfKey, priorUser);
    queryClient.setQueryData(maybeSelfKey, priorUser);
    TestBed.inject(ConfigService).tenantSignal.set(currentTenant);
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(button(root, 'Make this my home organization').disabled).toBe(
        false,
      );
      expect(root.textContent).toContain('Original Organization');
    });

    type HomeResult = Awaited<
      ReturnType<
        NonNullable<
          ReturnType<
            Client['users']['setHomeTenant']['mutationOptions']
          >['mutationFn']
        >
      >
    >;
    const homeResult = {
      homeTenantId: currentTenant.id,
      homeTenantName: currentTenant.name,
    } satisfies HomeResult;
    const write = gate<HomeResult>(homeResult);
    setHome.mockImplementationOnce(() => write.promise);
    button(root, 'Make this my home organization').click();
    const mutationCache = queryClient.getMutationCache();
    const homeMutation = mutationCache.find({ mutationKey: homeKey });
    if (!homeMutation)
      throw new Error('Expected the real home-organization mutation.');
    const mutationSettled = observe(
      // Signal Forms test compilation targets ES2022, so Promise.withResolvers is unavailable.

      new Promise<void>((resolve, reject) => {
        const settle = () => {
          if (homeMutation.state.status === 'success') resolve();
          else if (homeMutation.state.status === 'error')
            reject(homeMutation.state.error);
        };
        unsubscribeObservers.push(
          mutationCache.subscribe((event) => {
            if (event.type === 'updated' && event.mutation === homeMutation)
              settle();
          }),
        );
        settle();
      }),
    );
    try {
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(setHome).toHaveBeenCalledOnce();
        expect(homeMutation.state.status).toBe('pending');
        expect(button(root, 'Changing…').disabled).toBe(true);
      });
      fixture.componentInstance['setCurrentTenantAsHome']();
      expect(setHome.mock.calls).toEqual([
        [
          undefined,
          { client: queryClient, meta: homeMeta, mutationKey: homeKey },
        ],
      ]);
      expect(mutationCache.getAll()).toHaveLength(1);
      expect(queryClient.getQueryData(selfKey)).toEqual(priorUser);
      expect(queryClient.getQueryData(maybeSelfKey)).toEqual(priorUser);
      expect(successNotice).not.toHaveBeenCalled();
      write.release(homeResult);
      await mutationSettled;
      const expectedUser = {
        ...priorUser,
        ...homeResult,
      } satisfies ProfileUser;
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(queryClient.getQueryData(selfKey)).toEqual(expectedUser);
        expect(queryClient.getQueryData(maybeSelfKey)).toEqual(expectedUser);
        const homeLabel = [...root.querySelectorAll('dt')].find(
          (label) => label.textContent?.trim() === 'Home organization',
        );
        expect(homeLabel?.nextElementSibling?.textContent?.trim()).toBe(
          currentTenant.name,
        );
        expect(root.textContent).not.toContain(
          'You are viewing another organization',
        );
      });
      expect(
        queryClient
          .getQueryCache()
          .find({ exact: true, queryKey: pathKey(['users', 'self']) }),
      ).toBeUndefined();
      expect(
        queryClient
          .getQueryCache()
          .find({ exact: true, queryKey: pathKey(['users', 'maybeSelf']) }),
      ).toBeUndefined();
      expect(setHome.mock.calls).toEqual([
        [
          undefined,
          { client: queryClient, meta: homeMeta, mutationKey: homeKey },
        ],
      ]);
      expect(mutationCache.getAll()).toHaveLength(1);
      expect(homeMutation.state.status).toBe('success');
      expect(findSelf).toHaveBeenCalledOnce();
      expect(findMaybeSelf).toHaveBeenCalledOnce();
      expect(findReceipts).toHaveBeenCalledOnce();
      expect(update).not.toHaveBeenCalled();
      expect(errorNotice).not.toHaveBeenCalled();
      expect(successNotice).toHaveBeenCalledExactlyOnceWith(
        'Current Organization is now your home organization',
      );
    } finally {
      write.release(homeResult);
      await Promise.allSettled([mutationSettled]);
    }
  });

  it.each(['home', 'profile'] as const)(
    'preserves both changes when the %s write finishes first during overlapping home and profile saves',
    async (first) => {
      const priorUser: ProfileUser = {
        ...originalUser,
        communicationEmail: 'before-overlap@example.org',
        firstName: 'Before',
        homeTenantId: 'tenant-original',
        homeTenantName: 'Original Organization',
        iban: 'GB82WEST12345698765432',
        lastName: 'Overlap',
        paypalEmail: 'before-refunds@example.org',
        permissions: ['templates:view'],
        roleIds: ['role-overlap'],
      };
      const currentTenant = new ClientTenantConfig({
        cancellationDeadlineHoursBeforeStart: 24,
        currency: 'EUR',
        defaultLocation: undefined,
        discountProviders: { esnCard: { config: {}, status: 'disabled' } },
        domain: 'current.example.org',
        emailSenderEmail: undefined,
        emailSenderName: undefined,
        faviconUrl: undefined,
        id: 'tenant-current',
        legalNoticeText: undefined,
        legalNoticeUrl: undefined,
        logoUrl: undefined,
        maxActiveRegistrationsPerUser: 3,
        name: 'Current Organization',
        paymentsConfigured: true,
        privacyPolicyText: undefined,
        privacyPolicyUrl: undefined,
        receiptSettings: { allowOther: false, receiptCountries: ['DE'] },
        refundFeesOnCancellation: false,
        seoDescription: undefined,
        seoTitle: undefined,
        termsText: undefined,
        termsUrl: undefined,
        theme: 'evorto',
        timezone: 'Europe/Berlin',
        transferDeadlineHoursBeforeStart: 24,
      });
      type HomeResult = Awaited<
        ReturnType<
          NonNullable<
            ReturnType<
              Client['users']['setHomeTenant']['mutationOptions']
            >['mutationFn']
          >
        >
      >;
      const homeResult = {
        homeTenantId: currentTenant.id,
        homeTenantName: currentTenant.name,
      } satisfies HomeResult;
      const expectedUser = {
        ...priorUser,
        ...payload,
        ...homeResult,
      } satisfies ProfileUser;
      currentUser = priorUser;
      queryClient.setQueryData(selfKey, priorUser);
      queryClient.setQueryData(maybeSelfKey, priorUser);
      TestBed.inject(ConfigService).tenantSignal.set(currentTenant);
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(button(root, 'Make this my home organization').disabled).toBe(
          false,
        );
      });

      const homeWrite = gate<undefined>(undefined);
      const profileWrite = gate<undefined>(undefined);
      const selfRead = gate<ProfileUser>(expectedUser);
      const maybeSelfRead = gate<ProfileUser>(expectedUser);
      setHome.mockImplementationOnce(async () => {
        await homeWrite.promise;
        currentUser = { ...currentUser, ...homeResult };
        return homeResult;
      });
      update.mockImplementationOnce(async (result) => {
        await profileWrite.promise;
        currentUser = {
          ...currentUser,
          ...result,
          iban: result.iban ?? undefined,
          paypalEmail: result.paypalEmail ?? undefined,
        };
      });
      findSelf.mockImplementationOnce(() => selfRead.promise);
      findMaybeSelf.mockImplementationOnce(() => maybeSelfRead.promise);

      button(root, 'Make this my home organization').click();
      const mutationCache = queryClient.getMutationCache();
      const homeMutation = mutationCache.find({ mutationKey: homeKey });
      if (!homeMutation)
        throw new Error('Expected the real home-organization mutation.');
      const homeSettled = observe(
        // Signal Forms test compilation targets ES2022, so Promise.withResolvers is unavailable.

        new Promise<void>((resolve, reject) => {
          const settle = () => {
            if (homeMutation.state.status === 'success') resolve();
            else if (homeMutation.state.status === 'error')
              reject(homeMutation.state.error);
          };
          unsubscribeObservers.push(
            mutationCache.subscribe((event) => {
              if (event.type === 'updated' && event.mutation === homeMutation)
                settle();
            }),
          );
          settle();
        }),
      );
      let profileOperation: Promise<void> | undefined;
      try {
        await vi.waitFor(() => {
          fixture.detectChanges();
          expect(homeMutation.state.status).toBe('pending');
          expect(button(root, 'Changing…').disabled).toBe(true);
          expect(button(root, 'Edit profile').disabled).toBe(false);
        });
        const editor = await openEditor();
        profileOperation = editor.submitForm();
        const profileMutation = mutationCache.find({ mutationKey: updateKey });
        if (!profileMutation)
          throw new Error('Expected the real profile mutation.');
        await vi.waitFor(() => {
          editor.detect();
          expect(homeMutation.state.status).toBe('pending');
          expect(profileMutation.state.status).toBe('pending');
          editor.expectLocked();
          expect(setHome).toHaveBeenCalledOnce();
          expect(update).toHaveBeenCalledOnce();
        });
        expect(queryClient.getQueryData(selfKey)).toEqual(priorUser);
        expect(queryClient.getQueryData(maybeSelfKey)).toEqual(priorUser);
        if (first === 'home') {
          homeWrite.release(undefined);
          await homeSettled;
          const intermediateUser = { ...priorUser, ...homeResult };
          expect(currentUser).toEqual(intermediateUser);
          expect(queryClient.getQueryData(selfKey)).toEqual(intermediateUser);
          expect(queryClient.getQueryData(maybeSelfKey)).toEqual(
            intermediateUser,
          );
          expect(profileMutation.state.status).toBe('pending');
          expect(findSelf).toHaveBeenCalledOnce();
          expect(findMaybeSelf).toHaveBeenCalledOnce();
        }

        profileWrite.release(undefined);
        await vi.waitFor(() => {
          editor.detect();
          expect(profileMutation.state.status).toBe('success');
          expect(queryClient.getQueryState(selfKey)?.fetchStatus).toBe(
            'fetching',
          );
          expect(queryClient.getQueryState(maybeSelfKey)?.fetchStatus).toBe(
            'fetching',
          );
          expectRefreshes();
          editor.expectLocked();
        });
        if (first === 'profile') {
          const intermediateUser = { ...priorUser, ...payload };
          expect(currentUser).toEqual(intermediateUser);
          expect(queryClient.getQueryData(selfKey)).toEqual(intermediateUser);
          expect(queryClient.getQueryData(maybeSelfKey)).toEqual(
            intermediateUser,
          );
          expect(homeMutation.state.status).toBe('pending');
          homeWrite.release(undefined);
          await homeSettled;
        }

        // Both actual profile reads remain held: they cannot repair a stale cache overwrite.
        expect(currentUser).toEqual(expectedUser);
        await vi.waitFor(() => {
          fixture.detectChanges();
          expect(queryClient.getQueryData(selfKey)).toEqual(expectedUser);
          expect(queryClient.getQueryData(maybeSelfKey)).toEqual(expectedUser);
          const valueFor = (title: string) =>
            [...root.querySelectorAll('dt')]
              .find((label) => label.textContent?.trim() === title)
              ?.nextElementSibling?.textContent?.trim();
          expect(valueFor('Home organization')).toBe(currentTenant.name);
          expect(valueFor('Email for updates')).toBe(
            payload.communicationEmail,
          );
          expect(valueFor('Sign-in email')).toBe(priorUser.email);
          expect(root.textContent).toContain('Alice Changed');
        });
        expect(queryClient.getQueryState(selfKey)?.fetchStatus).toBe(
          'fetching',
        );
        expect(queryClient.getQueryState(maybeSelfKey)?.fetchStatus).toBe(
          'fetching',
        );
        expect(successNotice).not.toHaveBeenCalledWith('Profile updated');
        expect(setHome.mock.calls).toEqual([
          [
            undefined,
            { client: queryClient, meta: homeMeta, mutationKey: homeKey },
          ],
        ]);
        expect(update.mock.calls).toEqual([
          [
            payload,
            { client: queryClient, meta: updateMeta, mutationKey: updateKey },
          ],
        ]);

        selfRead.release(currentUser);
        maybeSelfRead.release(currentUser);
        await profileOperation;
        await vi.waitFor(() => {
          fixture.detectChanges();
          expect(dialog.openDialogs).toHaveLength(0);
          expect(button(root, 'Edit profile').disabled).toBe(false);
          expect(root.textContent).not.toContain(
            'You are viewing another organization',
          );
        });
        expect(queryClient.getQueryData(selfKey)).toEqual(expectedUser);
        expect(queryClient.getQueryData(maybeSelfKey)).toEqual(expectedUser);
        expect(
          queryClient
            .getQueryCache()
            .find({ exact: true, queryKey: pathKey(['users', 'self']) }),
        ).toBeUndefined();
        expect(
          queryClient
            .getQueryCache()
            .find({ exact: true, queryKey: pathKey(['users', 'maybeSelf']) }),
        ).toBeUndefined();
        expectRefreshes();
        expect(setHome).toHaveBeenCalledOnce();
        expect(update).toHaveBeenCalledOnce();
        expect(errorNotice).not.toHaveBeenCalled();
        expect(successNotice.mock.calls).toEqual([
          ['Current Organization is now your home organization'],
          ['Profile updated'],
        ]);
      } finally {
        homeWrite.release(undefined);
        profileWrite.release(undefined);
        selfRead.release(expectedUser);
        maybeSelfRead.release(expectedUser);
        await Promise.allSettled([
          homeSettled,
          ...(profileOperation ? [profileOperation] : []),
        ]);
      }
    },
  );

  it('leaves another user error and invalidation state and an empty maybe-self cache unchanged after the old home response', async () => {
    const priorUser: ProfileUser = {
      ...originalUser,
      homeTenantId: 'tenant-original',
      homeTenantName: 'Original Organization',
    };
    const currentTenant = new ClientTenantConfig({
      cancellationDeadlineHoursBeforeStart: 24,
      currency: 'EUR',
      defaultLocation: undefined,
      discountProviders: { esnCard: { config: {}, status: 'disabled' } },
      domain: 'current.example.org',
      emailSenderEmail: undefined,
      emailSenderName: undefined,
      faviconUrl: undefined,
      id: 'tenant-current',
      legalNoticeText: undefined,
      legalNoticeUrl: undefined,
      logoUrl: undefined,
      maxActiveRegistrationsPerUser: 3,
      name: 'Current Organization',
      paymentsConfigured: true,
      privacyPolicyText: undefined,
      privacyPolicyUrl: undefined,
      receiptSettings: { allowOther: false, receiptCountries: ['DE'] },
      refundFeesOnCancellation: false,
      seoDescription: undefined,
      seoTitle: undefined,
      termsText: undefined,
      termsUrl: undefined,
      theme: 'evorto',
      timezone: 'Europe/Berlin',
      transferDeadlineHoursBeforeStart: 24,
    });
    currentUser = priorUser;
    queryClient.setQueryData(selfKey, priorUser);
    queryClient.setQueryData(maybeSelfKey, priorUser);
    TestBed.inject(ConfigService).tenantSignal.set(currentTenant);
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(button(root, 'Make this my home organization').disabled).toBe(
        false,
      );
    });
    type HomeResult = Awaited<
      ReturnType<
        NonNullable<
          ReturnType<
            Client['users']['setHomeTenant']['mutationOptions']
          >['mutationFn']
        >
      >
    >;
    const homeResult = {
      homeTenantId: currentTenant.id,
      homeTenantName: currentTenant.name,
    } satisfies HomeResult;
    const write = gate<HomeResult>(homeResult);
    setHome.mockImplementationOnce(() => write.promise);
    button(root, 'Make this my home organization').click();
    const mutationCache = queryClient.getMutationCache();
    const homeMutation = mutationCache.find({ mutationKey: homeKey });
    if (!homeMutation)
      throw new Error('Expected the real home-organization mutation.');
    const mutationSettled = observe(
      // Signal Forms test compilation targets ES2022, so Promise.withResolvers is unavailable.

      new Promise<void>((resolve, reject) => {
        const settle = () => {
          if (homeMutation.state.status === 'success') resolve();
          else if (homeMutation.state.status === 'error')
            reject(homeMutation.state.error);
        };
        unsubscribeObservers.push(
          mutationCache.subscribe((event) => {
            if (event.type === 'updated' && event.mutation === homeMutation)
              settle();
          }),
        );
        settle();
      }),
    );
    try {
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(homeMutation.state.status).toBe('pending');
        expect(button(root, 'Changing…').disabled).toBe(true);
      });
      const differentUser: ProfileUser = {
        ...originalUser,
        auth0Id: 'auth0|another-profile',
        communicationEmail: 'another-profile@example.org',
        email: 'another-signin@example.org',
        firstName: 'Another',
        homeTenantId: 'tenant-another',
        homeTenantName: 'Another Organization',
        id: 'another-profile-user',
        lastName: 'Person',
        permissions: ['templates:view'],
        roleIds: ['role-another'],
      };
      currentUser = differentUser;
      queryClient.setQueryData(selfKey, differentUser);
      queryClient.setQueryData<null | ProfileUser>(maybeSelfKey, null);
      const readFailure = new Error(
        'The current user profile could not be loaded',
      );
      findSelf.mockRejectedValueOnce(readFailure);
      await expect(
        queryClient.refetchQueries(
          { exact: true, queryKey: selfKey },
          { throwOnError: true },
        ),
      ).rejects.toBe(readFailure);
      await queryClient.invalidateQueries({
        exact: true,
        queryKey: selfKey,
        refetchType: 'none',
      });
      await queryClient.invalidateQueries({
        exact: true,
        queryKey: maybeSelfKey,
        refetchType: 'none',
      });
      const selfState = queryClient.getQueryState(selfKey);
      const maybeSelfState = queryClient.getQueryState(maybeSelfKey);
      if (!selfState || !maybeSelfState)
        throw new Error('Expected both existing canonical query states.');
      expect(selfState.data).toEqual(differentUser);
      expect(selfState.status).toBe('error');
      expect(selfState.error).toBe(readFailure);
      expect(selfState.isInvalidated).toBe(true);
      expect(maybeSelfState.data).toBeNull();
      expect(maybeSelfState.isInvalidated).toBe(true);

      write.release(homeResult);
      await mutationSettled;
      fixture.detectChanges();
      expect(homeMutation.state.status).toBe('success');
      expect(queryClient.getQueryState(selfKey)).toEqual(selfState);
      expect(queryClient.getQueryState(maybeSelfKey)).toEqual(maybeSelfState);
      expect(queryClient.getQueryData(selfKey)).toEqual(differentUser);
      expect(queryClient.getQueryData(maybeSelfKey)).toBeNull();
      expect(
        queryClient
          .getQueryCache()
          .find({ exact: true, queryKey: pathKey(['users', 'self']) }),
      ).toBeUndefined();
      expect(
        queryClient
          .getQueryCache()
          .find({ exact: true, queryKey: pathKey(['users', 'maybeSelf']) }),
      ).toBeUndefined();
      expect(setHome.mock.calls).toEqual([
        [
          undefined,
          { client: queryClient, meta: homeMeta, mutationKey: homeKey },
        ],
      ]);
      expect(findSelf).toHaveBeenCalledTimes(2);
      expect(findMaybeSelf).toHaveBeenCalledOnce();
      expect(findReceipts).toHaveBeenCalledOnce();
      expect(update).not.toHaveBeenCalled();
    } finally {
      write.release(homeResult);
      await Promise.allSettled([mutationSettled]);
    }
  });
  it.each([
    [
      'unknown',
      new Error('Private home response lost after a simulated commit'),
      true,
      "We couldn't confirm whether your home organization changed. Open your profile in another tab and check your home organization before trying again.",
    ],
    [
      'Internal',
      new RpcInternalServerError({
        message: 'Private internal failure after a simulated home commit',
      }),
      true,
      "We couldn't confirm whether your home organization changed. Open your profile in another tab and check your home organization before trying again.",
    ],
    [
      'Unauthorized',
      new RpcUnauthorizedError({
        message: 'Private missing membership context',
      }),
      false,
      'Your home organization was not changed. Sign in again and check your membership in this organization before trying again.',
    ],
  ] as const)(
    'explains the %s outcome after one native home-organization mutation',
    async (_kind, error, committed, message) => {
      const priorUser: ProfileUser = {
        ...originalUser,
        homeTenantId: 'tenant-original',
        homeTenantName: 'Original Organization',
      };
      const currentTenant = new ClientTenantConfig({
        cancellationDeadlineHoursBeforeStart: 24,
        currency: 'EUR',
        defaultLocation: undefined,
        discountProviders: { esnCard: { config: {}, status: 'disabled' } },
        domain: 'current.example.org',
        emailSenderEmail: undefined,
        emailSenderName: undefined,
        faviconUrl: undefined,
        id: 'tenant-current',
        legalNoticeText: undefined,
        legalNoticeUrl: undefined,
        logoUrl: undefined,
        maxActiveRegistrationsPerUser: 3,
        name: 'Current Organization',
        paymentsConfigured: true,
        privacyPolicyText: undefined,
        privacyPolicyUrl: undefined,
        receiptSettings: { allowOther: false, receiptCountries: ['DE'] },
        refundFeesOnCancellation: false,
        seoDescription: undefined,
        seoTitle: undefined,
        termsText: undefined,
        termsUrl: undefined,
        theme: 'evorto',
        timezone: 'Europe/Berlin',
        transferDeadlineHoursBeforeStart: 24,
      });
      const homeResult = {
        homeTenantId: currentTenant.id,
        homeTenantName: currentTenant.name,
      };
      currentUser = priorUser;
      queryClient.setQueryData(selfKey, priorUser);
      queryClient.setQueryData(maybeSelfKey, priorUser);
      TestBed.inject(ConfigService).tenantSignal.set(currentTenant);
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(button(root, 'Make this my home organization').disabled).toBe(
          false,
        );
      });
      const selfState = queryClient.getQueryState(selfKey);
      const maybeSelfState = queryClient.getQueryState(maybeSelfKey);
      const write = gate<undefined>(undefined);
      setHome.mockImplementationOnce(async () => {
        await write.promise;
        if (committed) currentUser = { ...currentUser, ...homeResult };
        throw error;
      });
      button(root, 'Make this my home organization').click();
      const mutationCache = queryClient.getMutationCache();
      const homeMutation = mutationCache.find({ mutationKey: homeKey });
      if (!homeMutation)
        throw new Error('Expected the real home-organization mutation.');
      const mutationSettled = observe(
        // Signal Forms test compilation targets ES2022, so Promise.withResolvers is unavailable.

        new Promise<void>((resolve, reject) => {
          const settle = () => {
            if (homeMutation.state.status === 'success') resolve();
            else if (homeMutation.state.status === 'error') {
              if (homeMutation.state.error === error) resolve();
              else reject(homeMutation.state.error);
            }
          };
          unsubscribeObservers.push(
            mutationCache.subscribe((event) => {
              if (event.type === 'updated' && event.mutation === homeMutation)
                settle();
            }),
          );
          settle();
        }),
      );
      try {
        await vi.waitFor(() => {
          fixture.detectChanges();
          expect(homeMutation.state.status).toBe('pending');
          expect(button(root, 'Changing…').disabled).toBe(true);
          expect(setHome).toHaveBeenCalledOnce();
        });
        fixture.componentInstance['setCurrentTenantAsHome']();
        expect(setHome).toHaveBeenCalledOnce();
        expect(errorNotice).not.toHaveBeenCalled();
        write.release(undefined);
        await mutationSettled;
        await vi.waitFor(() => {
          fixture.detectChanges();
          expect(errorNotice).toHaveBeenCalledExactlyOnceWith(message);
          expect(button(root, 'Make this my home organization').disabled).toBe(
            false,
          );
          const homeLabel = [...root.querySelectorAll('dt')].find(
            (label) => label.textContent?.trim() === 'Home organization',
          );
          expect(homeLabel?.nextElementSibling?.textContent?.trim()).toBe(
            'Original Organization',
          );
        });
        expect(homeMutation.state.status).toBe('error');
        expect(homeMutation.state.error).toBe(error);
        expect(currentUser).toEqual(
          committed ? { ...priorUser, ...homeResult } : priorUser,
        );
        expect(queryClient.getQueryState(selfKey)).toEqual(selfState);
        expect(queryClient.getQueryState(maybeSelfKey)).toEqual(maybeSelfState);
        expect(queryClient.getQueryData(selfKey)).toEqual(priorUser);
        expect(queryClient.getQueryData(maybeSelfKey)).toEqual(priorUser);
        expect(setHome.mock.calls).toEqual([
          [
            undefined,
            { client: queryClient, meta: homeMeta, mutationKey: homeKey },
          ],
        ]);
        expect(mutationCache.getAll()).toHaveLength(1);
        expect(findSelf).toHaveBeenCalledOnce();
        expect(findMaybeSelf).toHaveBeenCalledOnce();
        expect(findReceipts).toHaveBeenCalledOnce();
        expect(update).not.toHaveBeenCalled();
        expect(successNotice).not.toHaveBeenCalled();
      } finally {
        write.release(undefined);
        await Promise.allSettled([mutationSettled]);
      }
    },
  );
});
