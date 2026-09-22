import type { ComponentFixture } from '@angular/core/testing';

import { TestBed } from '@angular/core/testing';
import {
  createRpcQueryFilter,
  createRpcQueryKey,
} from '@heddendorp/effect-angular-query';
import {
  onlineManager,
  provideTanStackQuery,
  QueryClient,
  QueryObserver,
} from '@tanstack/angular-query-experimental';
import { readFileSync } from 'node:fs';
import nodePath from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  RpcForbiddenError,
  RpcInternalServerError,
  RpcUnauthorizedError,
} from '../../../shared/errors/rpc-errors';
import {
  TenantOnboardingConfigurationError,
  TenantOnboardingValidationError,
} from '../../../shared/rpc-contracts/app-rpcs/onboarding.errors';
import {
  TenantOnboardingQuestionRecord,
  TenantPrivacyPolicyVersionRecord,
} from '../../../shared/rpc-contracts/app-rpcs/onboarding.rpcs';
import { NotificationService } from '../../core/notification.service';
import {
  onboardingOptionsFromText,
  onboardingOptionsValidationMessage,
  onboardingPublishNotice,
  OnboardingSettingsComponent,
  OnboardingSettingsOperations,
} from './onboarding-settings.component';

const template = readFileSync(
  nodePath.join(
    process.cwd(),
    'src/app/admin/onboarding-settings/onboarding-settings.component.html',
  ),
  'utf8',
);

describe('tenant onboarding settings', () => {
  it('trims, removes empty lines, and de-duplicates selection options', () => {
    expect(
      onboardingOptionsFromText(' Student \n\nVolunteer\nStudent\n'),
    ).toEqual(['Student', 'Volunteer']);
  });

  it('uses the same option count and length limits as the server', () => {
    expect(onboardingOptionsValidationMessage('One\nTwo')).toBeUndefined();
    expect(onboardingOptionsValidationMessage('Only one')).toBe(
      'Add between 2 and 20 choices.',
    );
    expect(
      onboardingOptionsValidationMessage(
        Array.from({ length: 21 }, (_, index) => `Option ${index + 1}`).join(
          '\n',
        ),
      ),
    ).toBe('Add between 2 and 20 choices.');
    expect(onboardingOptionsValidationMessage(`${'x'.repeat(81)}\nTwo`)).toBe(
      'Each choice must be 80 characters or fewer.',
    );
  });

  it('explains accepted policy links and selection limits in the form', () => {
    expect(template).toContain('link to it on another website');
    expect(template).toContain('2 to 20 different choices');
    expect(template).toContain('placeholder="Choice one&#10;Choice two"');
    expect(template).toContain('question.optionsText().errors()');
    expect(template).toContain('<mat-error>{{ error.message }}</mat-error>');
  });

  it('renders every blocking policy and question prompt error inline', () => {
    expect(template).toContain(
      'error of settingsForm.privacyPolicyText().errors()',
    );
    expect(template).toContain('error of question.prompt().errors()');
  });

  it('tells the publishing administrator exactly who must re-accept', () => {
    expect(
      onboardingPublishNotice({
        affectedUsers: 12,
        policyChanged: true,
        policyVersion: 3,
        questionsChanged: false,
      }),
    ).toBe(
      'Privacy policy updated. 12 members must accept the new policy before continuing.',
    );
  });

  it('explains changed question enforcement without claiming a policy change', () => {
    expect(
      onboardingPublishNotice({
        affectedUsers: 0,
        policyChanged: false,
        policyVersion: 3,
        questionsChanged: true,
      }),
    ).toBe(
      'Questions updated. Members who have not answered them will be asked before continuing.',
    );
  });
});

describe('OnboardingSettingsComponent publication', () => {
  type PublishMutation = NonNullable<
    ReturnType<OnboardingSettingsOperations['publishSettings']>['mutationFn']
  >;
  type PublishedSettings = Awaited<ReturnType<PublishMutation>>;
  type SavedSettings = Awaited<
    ReturnType<
      Exclude<
        ReturnType<OnboardingSettingsOperations['settings']>['queryFn'],
        symbol | undefined
      >
    >
  >;
  const settingsKey = createRpcQueryKey(['onboarding', 'adminSettings'], {
    keyPrefix: 'rpc',
    type: 'query',
  });
  const settingsFilter = createRpcQueryFilter(['onboarding', 'adminSettings'], {
    keyPrefix: 'rpc',
  });
  const savedSettings: SavedSettings = {
    policy: new TenantPrivacyPolicyVersionRecord({
      id: 'policy-1',
      privacyPolicyText: 'Current policy',
      privacyPolicyUrl: null,
      version: 1,
    }),
    questions: [],
  };
  const unchangedPublication: PublishedSettings = {
    affectedUsers: 0,
    policyChanged: false,
    policyVersion: 1,
    questionsChanged: false,
  };
  const changedPublication: PublishedSettings = {
    affectedUsers: 1,
    policyChanged: true,
    policyVersion: 2,
    questionsChanged: false,
  };
  const enteredValues = {
    privacyPolicyText: 'Policy text entered by the administrator',
    privacyPolicyUrl: 'https://section.example.org/privacy',
    questions: [
      {
        optionsText: ' Student \nVolunteer\nStudent\n',
        prompt: 'Which role describes you?',
        type: 'selection',
      },
    ],
  };
  const expectedPayload: Parameters<PublishMutation>[0] = {
    privacyPolicyText: enteredValues.privacyPolicyText,
    privacyPolicyUrl: enteredValues.privacyPolicyUrl,
    questions: [
      {
        options: ['Student', 'Volunteer'],
        prompt: enteredValues.questions[0].prompt,
        type: 'selection',
      },
    ],
  };
  const unknownMessage =
    'The publication outcome could not be confirmed. Your entries are still here. Load saved setup to check what was published before trying again. This replaces these entries with the saved values.';
  const failedReadMessage =
    'Evorto confirmed there were no changes to publish, but the saved setup could not be loaded. Your entries are still here. Load saved setup before making more changes. This replaces these entries with the saved values.';
  const loadSettings = vi.fn<() => Promise<SavedSettings>>();
  const publishSettings = vi.fn<PublishMutation>();
  const continueOnboarding =
    vi.fn<OnboardingSettingsOperations['continueOnboarding']>();
  const showError = vi.fn<NotificationService['showError']>();
  const showSuccess = vi.fn<NotificationService['showSuccess']>();
  let queryClient: QueryClient;
  let acquiredQueryClient: QueryClient | undefined;
  let acquiredFixture:
    ComponentFixture<OnboardingSettingsComponent> | undefined;
  let originallyOnline: boolean;
  let releases: (() => void)[];
  let unsubscribers: (() => void)[];
  let saveSettlements: PromiseSettledResult<void>[];
  let saveOperations: Promise<void>[];

  const hold = <T>(fallback: T) => {
    let resolver: ((value: T) => void) | undefined;
    // Angular's browser target does not expose Promise.withResolvers.
    // eslint-disable-next-line unicorn/prefer-promise-with-resolvers
    const promise = new Promise<T>((resolve) => {
      resolver = resolve;
    });
    const resolve = (value: T) => {
      if (!resolver)
        throw new Error('The held onboarding operation is missing');
      resolver(value);
    };
    releases.push(() => resolve(fallback));
    return { promise, resolve };
  };

  const createFixture = () => {
    const fixture = TestBed.createComponent(OnboardingSettingsComponent);
    acquiredFixture = fixture;
    const save = fixture.componentInstance['save'].bind(
      fixture.componentInstance,
    );
    const operations = saveOperations;
    const settlements = saveSettlements;
    fixture.componentInstance['save'] = (event) => {
      const operation = save(event);
      operations.push(operation);
      void operation.then(
        () => {
          settlements.push({ status: 'fulfilled', value: undefined });
        },
        (error: unknown) => {
          settlements.push({ reason: error, status: 'rejected' });
        },
      );
      return operation;
    };
    return fixture;
  };

  const button = (root: HTMLElement, text: string) => {
    const result = [...root.querySelectorAll('button')].find((candidate) =>
      candidate.textContent?.includes(text),
    );
    if (!result) throw new Error(`Missing onboarding button: ${text}`);
    return result;
  };

  const field = (root: HTMLElement, selector: string) => {
    const result = root.querySelector(selector);
    if (
      !(result instanceof HTMLInputElement) &&
      !(result instanceof HTMLTextAreaElement)
    ) {
      throw new TypeError(`Missing onboarding field: ${selector}`);
    }
    return result;
  };

  const submitForm = (root: HTMLElement) => {
    const form = root.querySelector('form');
    if (!form) throw new Error('Onboarding form was not rendered');
    form.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
  };

  const enteredFormValues = (
    fixture: ComponentFixture<OnboardingSettingsComponent>,
  ) => {
    const value = fixture.componentInstance['settingsForm']().value();
    return {
      privacyPolicyText: value.privacyPolicyText,
      privacyPolicyUrl: value.privacyPolicyUrl,
      // Signal Forms adds internal row symbols; compare every application field.
      questions: value.questions.map(({ optionsText, prompt, type }) => ({
        optionsText,
        prompt,
        type,
      })),
    };
  };

  const createEditedFixture = async () => {
    loadSettings.mockResolvedValueOnce({
      ...savedSettings,
      questions: [
        new TenantOnboardingQuestionRecord({
          answer: null,
          id: 'question-1',
          options: ['Student', 'Volunteer'],
          prompt: 'Your role',
          type: 'selection',
        }),
      ],
    });
    const fixture = createFixture();
    const root: HTMLElement = fixture.nativeElement;
    fixture.detectChanges();
    await fixture.whenStable();
    await vi.waitFor(async () => {
      fixture.detectChanges();
      await fixture.whenStable();
      expect(root.querySelector('article')).not.toBeNull();
    });
    for (const [selector, value] of [
      ['input[type="url"]', enteredValues.privacyPolicyUrl],
      ['textarea[rows="8"]', enteredValues.privacyPolicyText],
      ['article input', enteredValues.questions[0].prompt],
      ['textarea[placeholder]', enteredValues.questions[0].optionsText],
    ]) {
      const input = field(root, selector);
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(enteredFormValues(fixture)).toEqual(enteredValues);
    expect(fixture.componentInstance['settingsForm']().invalid()).toBe(false);
    return { fixture, root };
  };

  const expectRetainedEntries = (
    fixture: ComponentFixture<OnboardingSettingsComponent>,
    root: HTMLElement,
    locked: boolean,
  ) => {
    fixture.detectChanges();
    expect(enteredFormValues(fixture)).toEqual(enteredValues);
    for (const [selector, value] of [
      ['input[type="url"]', enteredValues.privacyPolicyUrl],
      ['textarea[rows="8"]', enteredValues.privacyPolicyText],
      ['article input', enteredValues.questions[0].prompt],
      ['textarea[placeholder]', enteredValues.questions[0].optionsText],
    ]) {
      expect(field(root, selector).value).toBe(value);
      expect(field(root, selector).disabled).toBe(locked);
    }
    expect(
      root.querySelector('mat-select')?.getAttribute('aria-disabled'),
    ).toBe(String(locked));
    expect(button(root, 'Add question').disabled).toBe(locked);
    expect(
      root.querySelector<HTMLButtonElement>('[aria-label="Remove question"]')
        ?.disabled,
    ).toBe(locked);
    expect(button(root, 'Publish').disabled).toBe(locked);
  };

  const expectSinglePublication = () => {
    expect(publishSettings).toHaveBeenCalledExactlyOnceWith(
      expectedPayload,
      expect.anything(),
    );
  };

  const expectLoadDisclosure = (root: HTMLElement) => {
    expect(root.querySelector('a')?.getAttribute('href')).toBe(
      '/admin/onboarding',
    );
    expect(root.querySelector('a')?.textContent).toContain('Load saved setup');
    expect(root.textContent).toContain(
      'This replaces these entries with the saved values.',
    );
  };

  beforeEach(async () => {
    acquiredQueryClient = undefined;
    acquiredFixture = undefined;
    releases = [];
    unsubscribers = [];
    saveSettlements = [];
    saveOperations = [];
    originallyOnline = onlineManager.isOnline();
    onlineManager.setOnline(true);
    queryClient = new QueryClient({
      defaultOptions: {
        mutations: { retry: false },
        queries: { gcTime: 0, retry: false, staleTime: Infinity },
      },
    });
    acquiredQueryClient = queryClient;
    loadSettings.mockResolvedValue(savedSettings);
    await TestBed.configureTestingModule({
      imports: [OnboardingSettingsComponent],
      providers: [
        provideTanStackQuery(queryClient),
        {
          provide: NotificationService,
          useValue: { showError, showSuccess },
        },
        {
          provide: OnboardingSettingsOperations,
          useValue: {
            continueOnboarding,
            publishSettings: () => ({ mutationFn: publishSettings }),
            settings: () => ({
              queryFn: loadSettings,
              queryKey: settingsKey,
            }),
            settingsFilter: () => settingsFilter,
          },
        },
      ],
    }).compileComponents();
  });

  afterEach(async () => {
    const failures: unknown[] = [];
    const client = acquiredQueryClient;
    const fixture = acquiredFixture;
    const settlements = saveSettlements;
    const operations = saveOperations;
    const cleanup: readonly (() => unknown)[] = [
      ...releases,
      () => client?.cancelQueries(),
      () =>
        vi.waitFor(
          () => {
            expect(settlements).toHaveLength(operations.length);
          },
          { timeout: 2000 },
        ),
      ...unsubscribers,
      () => fixture?.destroy(),
      () => client?.clear(),
      () => TestBed.resetTestingModule(),
      () => onlineManager.setOnline(originallyOnline),
      () => vi.resetAllMocks(),
      () => vi.restoreAllMocks(),
    ];
    for (const dispose of cleanup) {
      try {
        await dispose();
      } catch (error) {
        failures.push(error);
      }
    }
    for (const result of settlements) {
      if (result.status === 'rejected' && !failures.includes(result.reason)) {
        failures.push(result.reason);
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, 'Onboarding fixture cleanup failed');
    }
  });

  it.each([
    { policyChanged: true, questionsChanged: false },
    { policyChanged: false, questionsChanged: true },
  ])(
    'opens onboarding immediately for changed requirements: %j',
    async (changes) => {
      publishSettings.mockResolvedValue({
        ...changes,
        affectedUsers: 1,
        policyVersion: 2,
      });
      const fixture = createFixture();
      fixture.detectChanges();
      await fixture.whenStable();
      const root: HTMLElement = fixture.nativeElement;
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(root.querySelector('form')).not.toBeNull();
      });

      root
        .querySelector('form')
        ?.dispatchEvent(
          new Event('submit', { bubbles: true, cancelable: true }),
        );

      await vi.waitFor(() => expect(continueOnboarding).toHaveBeenCalledOnce());
      expect(publishSettings).toHaveBeenCalledOnce();
      expect(loadSettings).toHaveBeenCalledOnce();
      expect(showError).not.toHaveBeenCalled();
    },
  );

  it('keeps unchanged settings open without requiring another acceptance', async () => {
    publishSettings.mockResolvedValue({
      affectedUsers: 0,
      policyChanged: false,
      policyVersion: 1,
      questionsChanged: false,
    });
    const fixture = createFixture();
    fixture.detectChanges();
    await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(root.querySelector('form')).not.toBeNull();
    });

    root
      .querySelector('form')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    await vi.waitFor(() => expect(loadSettings).toHaveBeenCalledTimes(2));
    expect(continueOnboarding).not.toHaveBeenCalled();
    expect(showError).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(showSuccess).toHaveBeenCalledExactlyOnceWith(
        'No changes to publish',
      ),
    );
    fixture.detectChanges();
    expect(fixture.componentInstance['publicationLocked']()).toBe(false);
    expect(button(root, 'Publish').disabled).toBe(false);
  });

  it('keeps a confirmed publication locked and retries only its failed continuation', async () => {
    const navigationError = new Error('Navigation was blocked');
    continueOnboarding.mockImplementationOnce(() => {
      throw navigationError;
    });
    publishSettings.mockResolvedValue(changedPublication);
    const { fixture, root } = await createEditedFixture();

    submitForm(root);
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(root.textContent).toContain(
        'The changes were published, but new member setup could not be opened.',
      );
    });
    expectRetainedEntries(fixture, root, true);
    expectSinglePublication();
    expect(loadSettings).toHaveBeenCalledOnce();
    expect(showError).not.toHaveBeenCalled();
    expect(showSuccess).not.toHaveBeenCalled();
    expect(root.querySelector('a')).toBeNull();

    submitForm(root);
    await fixture.componentInstance['save'](new Event('submit'));
    fixture.componentInstance['addQuestion']();
    fixture.componentInstance['removeQuestion'](0);
    expectRetainedEntries(fixture, root, true);
    button(root, 'Continue to new member setup').click();
    expect(continueOnboarding).toHaveBeenCalledTimes(2);
    expectSinglePublication();
  });

  it.each([
    { error: new Error('private lost response detail'), name: 'lost response' },
    {
      error: new RpcInternalServerError({ message: 'private internal detail' }),
      name: 'internal error',
    },
  ])(
    'retains entries and blocks replay after an uncertain $name',
    async ({ error }) => {
      const mutation = hold(changedPublication);
      let locallySimulatedCommit = false;
      publishSettings.mockImplementation(async () => {
        await mutation.promise;
        locallySimulatedCommit = true;
        throw error;
      });
      const { fixture, root } = await createEditedFixture();
      submitForm(root);
      await vi.waitFor(() => expect(publishSettings).toHaveBeenCalledOnce());
      expectRetainedEntries(fixture, root, true);
      submitForm(root);
      await fixture.componentInstance['save'](new Event('submit'));
      fixture.componentInstance['addQuestion']();
      fixture.componentInstance['removeQuestion'](0);
      expectSinglePublication();

      mutation.resolve(changedPublication);
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(root.textContent).toContain(unknownMessage);
      });
      expect(locallySimulatedCommit).toBe(true);
      expectRetainedEntries(fixture, root, true);
      expectLoadDisclosure(root);
      expect(root.textContent).not.toContain(error.message);
      expect(continueOnboarding).not.toHaveBeenCalled();
      expect(loadSettings).toHaveBeenCalledOnce();
      expect(showError).not.toHaveBeenCalled();
      expect(showSuccess).not.toHaveBeenCalled();
      submitForm(root);
      await fixture.componentInstance['save'](new Event('submit'));
      expectSinglePublication();
    },
  );

  it.each([
    {
      error: new TenantOnboardingConfigurationError({
        message: 'Add a privacy policy.',
      }),
      message: 'Add a privacy policy.',
      name: 'configuration',
    },
    {
      error: new TenantOnboardingValidationError({
        field: 'questions',
        message: 'Add two different choices.',
      }),
      message: 'Add two different choices.',
      name: 'validation',
    },
    {
      error: new RpcUnauthorizedError({ message: 'private sign-in detail' }),
      message: 'Sign in again before publishing these settings.',
      name: 'sign-in',
    },
    {
      error: new RpcForbiddenError({ message: 'private access detail' }),
      message:
        'Your account does not have access to publish these settings. Ask an administrator to check your access.',
      name: 'access',
    },
  ])(
    'keeps a typed $name denial correctable with the entered values',
    async ({ error, message }) => {
      publishSettings.mockRejectedValue(error);
      const { fixture, root } = await createEditedFixture();
      submitForm(root);
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(showError).toHaveBeenCalledExactlyOnceWith(message);
        expect(button(root, 'Publish').disabled).toBe(false);
      });
      expectRetainedEntries(fixture, root, false);
      expectSinglePublication();
      expect(fixture.componentInstance['publicationFeedback']()).toBeNull();
      expect(continueOnboarding).not.toHaveBeenCalled();
      expect(showSuccess).not.toHaveBeenCalled();
      expect(loadSettings).toHaveBeenCalledOnce();
    },
  );

  it('drains a matching active read after another read fails before completing the unchanged publication', async () => {
    publishSettings.mockResolvedValue(unchangedPublication);
    const { fixture, root } = await createEditedFixture();
    const sibling = hold(savedSettings);
    const readSibling = vi.fn(() => sibling.promise);
    const siblingKey = createRpcQueryKey(['onboarding', 'adminSettings'], {
      input: { view: 'other active setup view' },
      keyPrefix: 'rpc',
      type: 'query',
    });
    const observer = new QueryObserver(queryClient, {
      initialData: savedSettings,
      queryFn: readSibling,
      queryKey: siblingKey,
      staleTime: Infinity,
    });
    unsubscribers.push(
      observer.subscribe(() => {
        // This real observer keeps the matching sibling read active.
      }),
    );
    loadSettings.mockRejectedValueOnce(new Error('Reading saved setup failed'));
    submitForm(root);
    await vi.waitFor(() => {
      expect(queryClient.getQueryState(settingsKey)?.status).toBe('error');
      expect(readSibling).toHaveBeenCalledOnce();
    });
    fixture.detectChanges();
    expect(fixture.componentInstance['settingsForm']().submitting()).toBe(true);
    expect(fixture.componentInstance['publishMutation'].isPending()).toBe(
      false,
    );
    expect(fixture.componentInstance['publicationFeedback']()).toBeNull();
    expectRetainedEntries(fixture, root, true);
    expect(showSuccess).not.toHaveBeenCalled();
    submitForm(root);
    await fixture.componentInstance['save'](new Event('submit'));
    expectSinglePublication();

    sibling.resolve(savedSettings);
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(root.textContent).toContain(failedReadMessage);
      expect(fixture.componentInstance['settingsForm']().submitting()).toBe(
        false,
      );
    });
    expect(queryClient.getQueryState(siblingKey)?.fetchStatus).toBe('idle');
    expectRetainedEntries(fixture, root, true);
    expectLoadDisclosure(root);
    expect(showSuccess).not.toHaveBeenCalled();
    expect(showError).not.toHaveBeenCalled();
    expect(continueOnboarding).not.toHaveBeenCalled();
    expectSinglePublication();
  });

  it('keeps an unchanged publication locked when its current setup read is initially paused', async () => {
    const mutation = hold(unchangedPublication);
    publishSettings.mockReturnValue(mutation.promise);
    const { fixture, root } = await createEditedFixture();
    const cached = queryClient.getQueryData(settingsKey);
    submitForm(root);
    await vi.waitFor(() => expect(publishSettings).toHaveBeenCalledOnce());
    onlineManager.setOnline(false);
    mutation.resolve(unchangedPublication);
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(root.textContent).toContain(
        'Evorto confirmed there were no changes to publish, but the saved setup could not be checked while the connection is paused.',
      );
    });
    expect(queryClient.getQueryState(settingsKey)).toMatchObject({
      data: cached,
      fetchStatus: 'paused',
      isInvalidated: true,
      status: 'success',
    });
    expectRetainedEntries(fixture, root, true);
    expectLoadDisclosure(root);
    expect(loadSettings).toHaveBeenCalledOnce();
    expect(showSuccess).not.toHaveBeenCalled();
    expect(showError).not.toHaveBeenCalled();
    expect(continueOnboarding).not.toHaveBeenCalled();
    submitForm(root);
    await fixture.componentInstance['save'](new Event('submit'));
    expectSinglePublication();
  });

  it('does not reset entries or unlock after a cancelled read reverts to older successful data', async () => {
    publishSettings.mockResolvedValue(unchangedPublication);
    const { fixture, root } = await createEditedFixture();
    const cached = queryClient.getQueryData(settingsKey);
    const read = hold(savedSettings);
    loadSettings.mockReturnValueOnce(read.promise);
    submitForm(root);
    await vi.waitFor(() => {
      expect(loadSettings).toHaveBeenCalledTimes(2);
      expect(queryClient.getQueryState(settingsKey)?.fetchStatus).toBe(
        'fetching',
      );
    });
    await queryClient.cancelQueries(settingsFilter, { revert: true });
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(root.textContent).toContain(failedReadMessage);
    });
    expect(queryClient.getQueryState(settingsKey)).toMatchObject({
      data: cached,
      fetchStatus: 'idle',
      isInvalidated: true,
      status: 'success',
    });
    expectRetainedEntries(fixture, root, true);
    expectLoadDisclosure(root);
    expect(showSuccess).not.toHaveBeenCalled();
    expect(showError).not.toHaveBeenCalled();
    expect(continueOnboarding).not.toHaveBeenCalled();
    submitForm(root);
    await fixture.componentInstance['save'](new Event('submit'));
    expectSinglePublication();
  });

  it('preserves the ordinary read-error retry without publishing or replacing entered values', async () => {
    const { fixture, root } = await createEditedFixture();
    loadSettings.mockRejectedValueOnce(
      new Error('Background setup read failed'),
    );
    await queryClient.invalidateQueries(settingsFilter);
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(root.textContent).toContain(
        "We couldn't load the setup for new members.",
      );
      expect(root.querySelector('form')).toBeNull();
    });
    expect(enteredFormValues(fixture)).toEqual(enteredValues);
    expect(fixture.componentInstance['publicationFeedback']()).toBeNull();
    await fixture.componentInstance['save'](new Event('submit'));
    expect(publishSettings).not.toHaveBeenCalled();

    button(root, 'Try again').click();
    await vi.waitFor(async () => {
      fixture.detectChanges();
      await fixture.whenStable();
      expect(root.querySelector('form')).not.toBeNull();
    });
    expect(loadSettings).toHaveBeenCalledTimes(3);
    expectRetainedEntries(fixture, root, false);
    expect(publishSettings).not.toHaveBeenCalled();
    expect(continueOnboarding).not.toHaveBeenCalled();
    expect(showError).not.toHaveBeenCalled();
    expect(showSuccess).not.toHaveBeenCalled();
  });
});
