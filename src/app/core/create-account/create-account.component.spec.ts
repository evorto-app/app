import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { TenantOnboardingRequirementsChangedError } from '@shared/rpc-contracts/app-rpcs/onboarding.errors';
import {
  provideTanStackQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CreateAccountComponent,
  CreateAccountOperations,
} from './create-account.component';

const loadAuthData = vi.fn();
const loadRequirements = vi.fn();
const completeOnboarding = vi.fn();

const onboardingRequirements = (
  questions: readonly {
    answer: null | string;
    id: string;
    options: readonly string[];
    prompt: string;
    type: 'selection' | 'shortText';
  }[] = [],
) => ({
  complete: false,
  hasMembership: false,
  policy: {
    id: 'policy-1',
    privacyPolicyText: 'Current policy',
    privacyPolicyUrl: null,
    version: 1,
  },
  profile: null,
  questions,
  tenantId: 'tenant-1',
  tenantName: 'Example Section',
});

const normalizeText = (fixture: ComponentFixture<CreateAccountComponent>) =>
  fixture.nativeElement.textContent.replaceAll(/\s+/g, ' ').trim();

describe('CreateAccountComponent load recovery', () => {
  let queryClient: QueryClient;

  beforeEach(async () => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          gcTime: 0,
          retry: false,
        },
      },
    });

    await TestBed.configureTestingModule({
      imports: [CreateAccountComponent],
      providers: [
        provideTanStackQuery(queryClient),
        {
          provide: CreateAccountOperations,
          useValue: {
            authData: () => ({
              queryFn: loadAuthData,
              queryKey: ['auth-data'],
            }),
            completeOnboarding: () => ({
              mutationFn: completeOnboarding,
              mutationKey: ['complete-onboarding'],
            }),
            maybeSelfFilter: () => ({ queryKey: ['maybe-self'] }),
            onboardingRequirements: () => ({
              queryFn: loadRequirements,
              queryKey: ['onboarding-requirements'],
            }),
            onboardingStatusFilter: () => ({
              queryKey: ['onboarding-status'],
            }),
            selfFilter: () => ({ queryKey: ['self'] }),
          },
        },
        {
          provide: Router,
          useValue: { navigate: vi.fn() },
        },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    queryClient.clear();
    vi.clearAllMocks();
    TestBed.resetTestingModule();
  });

  it('announces a failed login-details load and retries before showing the form', async () => {
    loadRequirements.mockResolvedValue(onboardingRequirements());
    loadAuthData
      .mockRejectedValueOnce(new Error('Auth profile unavailable'))
      .mockResolvedValue({
        email: 'alex@example.org',
        email_verified: true,
        family_name: 'Morgan',
        given_name: 'Alex',
      });

    const fixture = TestBed.createComponent(CreateAccountComponent);
    fixture.detectChanges();

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(normalizeText(fixture)).toContain(
        'Organization setup could not be loaded',
      );
    });

    const alert: HTMLElement | null =
      fixture.nativeElement.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain(
      "Your verified login details or this organization's current requirements are unavailable.",
    );

    const retryButton: HTMLButtonElement | null =
      fixture.nativeElement.querySelector('button');
    expect(retryButton?.textContent?.trim()).toBe('Try again');
    retryButton?.click();

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(normalizeText(fixture)).toContain('Notification email');
    });
    expect(loadAuthData).toHaveBeenCalledTimes(2);
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
  });

  it('lets the user check again after verifying their login email', async () => {
    loadRequirements.mockResolvedValue(onboardingRequirements());
    loadAuthData
      .mockResolvedValueOnce({
        email: 'alex@example.org',
        email_verified: false,
        family_name: 'Morgan',
        given_name: 'Alex',
      })
      .mockResolvedValue({
        email: 'alex@example.org',
        email_verified: true,
        family_name: 'Morgan',
        given_name: 'Alex',
      });

    const fixture = TestBed.createComponent(CreateAccountComponent);
    fixture.detectChanges();

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(normalizeText(fixture)).toContain('Your email is not verified');
    });

    const retryButton = [
      ...fixture.nativeElement.querySelectorAll('button'),
    ].find((button) => button.textContent.trim() === 'Check again');
    expect(retryButton).toBeDefined();
    retryButton?.click();

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(normalizeText(fixture)).toContain('Notification email');
    });
    expect(loadAuthData).toHaveBeenCalledTimes(2);
  });

  it('shows inline errors for a malformed communication email and an unanswered required question', async () => {
    loadRequirements.mockResolvedValue(
      onboardingRequirements([
        {
          answer: null,
          id: 'question-1',
          options: [],
          prompt: 'Why are you joining?',
          type: 'shortText',
        },
      ]),
    );
    loadAuthData.mockResolvedValue({
      email: 'alex@example.org',
      email_verified: true,
      family_name: 'Morgan',
      given_name: 'Alex',
    });

    const fixture = TestBed.createComponent(CreateAccountComponent);
    fixture.detectChanges();

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(
        fixture.nativeElement.querySelector('[data-question-id="question-1"]'),
      ).not.toBeNull();
    });

    const emailInput: HTMLInputElement | null =
      fixture.nativeElement.querySelector(
        '[data-testid="communication-email"]',
      );
    const answerInput: HTMLInputElement | null =
      fixture.nativeElement.querySelector('[data-question-id="question-1"]');
    expect(emailInput).not.toBeNull();
    expect(answerInput).not.toBeNull();

    if (!emailInput || !answerInput) return;
    emailInput.value = 'not-an-email';
    emailInput.dispatchEvent(new Event('input', { bubbles: true }));
    emailInput.dispatchEvent(new Event('blur'));
    answerInput.dispatchEvent(new Event('input', { bubbles: true }));
    answerInput.dispatchEvent(new Event('blur'));

    await vi.waitFor(() => {
      fixture.detectChanges();
      const text = normalizeText(fixture);
      expect(text).toContain('Enter a valid email address.');
      expect(text).toContain('Answer this required question.');
    });
  });

  it('preserves entered answers and does not reload requirements after a transient submission failure', async () => {
    loadRequirements.mockResolvedValue(
      onboardingRequirements([
        {
          answer: null,
          id: 'question-1',
          options: [],
          prompt: 'Why are you joining?',
          type: 'shortText',
        },
      ]),
    );
    loadAuthData.mockResolvedValue({
      email: 'alex@example.org',
      email_verified: true,
      family_name: 'Morgan',
      given_name: 'Alex',
    });
    completeOnboarding.mockRejectedValue(
      new Error('Temporary connection problem'),
    );

    const fixture = TestBed.createComponent(CreateAccountComponent);
    fixture.detectChanges();

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(
        fixture.nativeElement.querySelector('[data-question-id="question-1"]'),
      ).not.toBeNull();
    });

    const answerInput: HTMLInputElement | null =
      fixture.nativeElement.querySelector('[data-question-id="question-1"]');
    const privacyCheckbox: HTMLInputElement | null =
      fixture.nativeElement.querySelector('input[type="checkbox"]');
    const form: HTMLFormElement | null =
      fixture.nativeElement.querySelector('form');
    expect(answerInput).not.toBeNull();
    expect(privacyCheckbox).not.toBeNull();
    expect(form).not.toBeNull();

    if (!answerInput || !privacyCheckbox || !form) return;
    answerInput.value = 'Keep my answer';
    answerInput.dispatchEvent(new Event('input', { bubbles: true }));
    answerInput.dispatchEvent(new Event('blur'));
    privacyCheckbox.click();
    fixture.detectChanges();
    form.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(completeOnboarding).toHaveBeenCalledOnce();
      expect(normalizeText(fixture)).toContain('Temporary connection problem');
    });

    const retainedAnswer: HTMLInputElement | null =
      fixture.nativeElement.querySelector('[data-question-id="question-1"]');
    expect(retainedAnswer?.value).toBe('Keep my answer');
    expect(loadRequirements).toHaveBeenCalledOnce();
  });

  it('reloads changed requirements and merges matching answers by question id', async () => {
    loadRequirements
      .mockResolvedValueOnce(
        onboardingRequirements([
          {
            answer: null,
            id: 'question-1',
            options: [],
            prompt: 'Why are you joining?',
            type: 'shortText',
          },
        ]),
      )
      .mockResolvedValue(
        onboardingRequirements([
          {
            answer: null,
            id: 'question-1',
            options: [],
            prompt: 'Why are you joining?',
            type: 'shortText',
          },
          {
            answer: null,
            id: 'question-2',
            options: [],
            prompt: 'What would you like to help with?',
            type: 'shortText',
          },
        ]),
      );
    loadAuthData.mockResolvedValue({
      email: 'alex@example.org',
      email_verified: true,
      family_name: 'Morgan',
      given_name: 'Alex',
    });
    completeOnboarding.mockRejectedValue(
      new TenantOnboardingRequirementsChangedError({
        message: 'The questions changed. Review them and submit again.',
      }),
    );

    const fixture = TestBed.createComponent(CreateAccountComponent);
    fixture.detectChanges();

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(
        fixture.nativeElement.querySelector('[data-question-id="question-1"]'),
      ).not.toBeNull();
    });

    const answerInput: HTMLInputElement | null =
      fixture.nativeElement.querySelector('[data-question-id="question-1"]');
    const privacyCheckbox: HTMLInputElement | null =
      fixture.nativeElement.querySelector('input[type="checkbox"]');
    const form: HTMLFormElement | null =
      fixture.nativeElement.querySelector('form');
    expect(answerInput).not.toBeNull();
    expect(privacyCheckbox).not.toBeNull();
    expect(form).not.toBeNull();

    if (!answerInput || !privacyCheckbox || !form) return;
    answerInput.value = 'Keep this matched answer';
    answerInput.dispatchEvent(new Event('input', { bubbles: true }));
    answerInput.dispatchEvent(new Event('blur'));
    privacyCheckbox.click();
    fixture.detectChanges();
    form.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(
        fixture.nativeElement.querySelector('[data-question-id="question-2"]'),
      ).not.toBeNull();
    });

    const retainedAnswer: HTMLInputElement | null =
      fixture.nativeElement.querySelector('[data-question-id="question-1"]');
    expect(retainedAnswer?.value).toBe('Keep this matched answer');
    expect(loadRequirements).toHaveBeenCalledTimes(2);
  });

  it('merges a background requirements refresh by id after the form is touched', async () => {
    loadRequirements
      .mockResolvedValueOnce(
        onboardingRequirements([
          {
            answer: null,
            id: 'question-1',
            options: [],
            prompt: 'First question',
            type: 'shortText',
          },
          {
            answer: null,
            id: 'question-2',
            options: [],
            prompt: 'Second question',
            type: 'shortText',
          },
        ]),
      )
      .mockResolvedValue({
        ...onboardingRequirements([
          {
            answer: null,
            id: 'question-2',
            options: [],
            prompt: 'Second question, revised',
            type: 'shortText',
          },
          {
            answer: null,
            id: 'question-1',
            options: [],
            prompt: 'First question, revised',
            type: 'shortText',
          },
          {
            answer: 'Previously saved answer',
            id: 'question-3',
            options: [],
            prompt: 'New question',
            type: 'shortText',
          },
        ]),
        policy: {
          id: 'policy-2',
          privacyPolicyText: 'Revised policy',
          privacyPolicyUrl: null,
          version: 2,
        },
      });
    loadAuthData.mockResolvedValue({
      email: 'alex@example.org',
      email_verified: true,
      family_name: 'Morgan',
      given_name: 'Alex',
    });

    const fixture = TestBed.createComponent(CreateAccountComponent);
    fixture.detectChanges();

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(
        fixture.nativeElement.querySelector('[data-question-id="question-2"]'),
      ).not.toBeNull();
    });

    const firstAnswer: HTMLInputElement | null =
      fixture.nativeElement.querySelector('[data-question-id="question-1"]');
    const secondAnswer: HTMLInputElement | null =
      fixture.nativeElement.querySelector('[data-question-id="question-2"]');
    const privacyCheckbox: HTMLInputElement | null =
      fixture.nativeElement.querySelector('input[type="checkbox"]');
    expect(firstAnswer).not.toBeNull();
    expect(secondAnswer).not.toBeNull();
    expect(privacyCheckbox).not.toBeNull();
    if (!firstAnswer || !secondAnswer || !privacyCheckbox) return;

    firstAnswer.value = 'Answer for question one';
    firstAnswer.dispatchEvent(new Event('input', { bubbles: true }));
    firstAnswer.dispatchEvent(new Event('blur'));
    secondAnswer.value = 'Answer for question two';
    secondAnswer.dispatchEvent(new Event('input', { bubbles: true }));
    secondAnswer.dispatchEvent(new Event('blur'));
    privacyCheckbox.click();
    fixture.detectChanges();
    expect(privacyCheckbox.checked).toBe(true);

    await queryClient.refetchQueries({
      queryKey: ['onboarding-requirements'],
    });

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(normalizeText(fixture)).toContain('Privacy policy version 2');
      expect(
        fixture.nativeElement.querySelector('[data-question-id="question-3"]'),
      ).not.toBeNull();
    });

    const retainedFirstAnswer: HTMLInputElement | null =
      fixture.nativeElement.querySelector('[data-question-id="question-1"]');
    const retainedSecondAnswer: HTMLInputElement | null =
      fixture.nativeElement.querySelector('[data-question-id="question-2"]');
    const addedAnswer: HTMLInputElement | null =
      fixture.nativeElement.querySelector('[data-question-id="question-3"]');
    const refreshedPrivacyCheckbox: HTMLInputElement | null =
      fixture.nativeElement.querySelector('input[type="checkbox"]');
    expect(retainedFirstAnswer?.value).toBe('Answer for question one');
    expect(retainedSecondAnswer?.value).toBe('Answer for question two');
    expect(addedAnswer?.value).toBe('Previously saved answer');
    expect(refreshedPrivacyCheckbox?.checked).toBe(false);
    expect(loadRequirements).toHaveBeenCalledTimes(2);
  });
});
