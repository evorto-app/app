import { Injector, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { form } from '@angular/forms/signals';
import {
  provideTanStackQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { readFileSync } from 'node:fs';
import nodePath from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  reconcileTransferClaimAnswers,
  registrationTransferCheckoutUrl,
  RegistrationTransferClaimComponent,
  RegistrationTransferClaimOperations,
  registrationTransferClaimPayload,
  registrationTransferLookupErrorCopy,
  registrationTransferStatusCopy,
  transferClaimFormSchema,
} from './registration-transfer-claim.component';

const readSource = (sourcePath: string): string =>
  readFileSync(nodePath.join(process.cwd(), sourcePath), 'utf8');

const transferClaim = (
  transferId: string,
  questionIds: readonly string[] | string,
  status: 'checkout_pending' | 'completed' = 'checkout_pending',
) => ({
  registrationOption: {
    questions: (typeof questionIds === 'string'
      ? [questionIds]
      : questionIds
    ).map((id) => ({ id, required: true })),
  },
  status,
  transferId,
});

const claimMutation = vi.fn();
const loadClaim = vi.fn();
const retryCheckoutMutation = vi.fn();

const answerInput = (
  fixture: ComponentFixture<RegistrationTransferClaimComponent>,
): HTMLInputElement | null => {
  const root: HTMLElement = fixture.nativeElement;
  return root.querySelector('input[data-question-id]');
};

const retryCheckoutButton = (
  fixture: ComponentFixture<RegistrationTransferClaimComponent>,
): HTMLButtonElement | null => {
  const root: HTMLElement = fixture.nativeElement;
  return root.querySelector('[data-retry-checkout]');
};

const unsafeCheckoutText = (
  fixture: ComponentFixture<RegistrationTransferClaimComponent>,
): null | string => {
  const root: HTMLElement = fixture.nativeElement;
  return root.querySelector('[data-unsafe-checkout]')?.textContent ?? null;
};

describe('RegistrationTransferClaimComponent form synchronization', () => {
  let queryClient: QueryClient;

  beforeEach(async () => {
    queryClient = new QueryClient({
      defaultOptions: {
        mutations: { retry: false },
        queries: { gcTime: 0, retry: false },
      },
    });
    claimMutation.mockReset();
    claimMutation.mockResolvedValue({
      eventId: 'event-1',
      registrationId: 'registration-1',
      status: 'confirmed',
    });
    loadClaim.mockReset();
    loadClaim.mockImplementation(async (credential: string) =>
      credential === 'offer-b'
        ? transferClaim('transfer-b', 'question-b')
        : transferClaim('transfer-a', 'question-a'),
    );
    retryCheckoutMutation.mockReset();
    retryCheckoutMutation.mockResolvedValue({ status: 'reconciled' });

    TestBed.overrideComponent(RegistrationTransferClaimComponent, {
      set: {
        template: `
          @if (claimQuery.isSuccess()) {
            <form data-claim-form (submit)="submitClaim($event)">
              @for (answerField of claimForm.answers; track answerField) {
                <input
                  [formField]="answerField.answer"
                  [attr.data-question-id]="answerField.questionId().value()"
                  [attr.data-touched]="answerField.answer().touched() ? 'true' : 'false'"
                />
              }
              <button data-submit-claim type="submit">Claim</button>
            </form>
            <button data-retry-checkout (click)="retryCheckout()">Retry</button>
            <span data-claim-status>{{ claimQuery.data()?.status }}</span>
            <span data-unsafe-checkout>{{ unsafeCheckout() }}</span>
          }
        `,
      },
    });

    await TestBed.configureTestingModule({
      imports: [RegistrationTransferClaimComponent],
      providers: [
        provideTanStackQuery(queryClient),
        {
          provide: RegistrationTransferClaimOperations,
          useValue: {
            claim: () => ({
              mutationFn: claimMutation,
              mutationKey: ['transfer-claim', 'claim'],
            }),
            getClaim: (credential: string) => ({
              queryFn: () => loadClaim(credential),
              queryKey: ['transfer-claim', credential],
            }),
            retryCheckout: () => ({
              mutationFn: retryCheckoutMutation,
              mutationKey: ['transfer-claim', 'retry'],
            }),
          },
        },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    queryClient.clear();
    vi.clearAllMocks();
    TestBed.resetTestingModule();
  });

  it('preserves same-transfer edits but resets them when the reused route loads another transfer', async () => {
    const fixture = TestBed.createComponent(RegistrationTransferClaimComponent);
    fixture.componentRef.setInput('credential', 'offer-a');
    fixture.detectChanges();

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(answerInput(fixture)?.dataset['questionId']).toBe('question-a');
    });

    const firstInput = answerInput(fixture);
    expect(firstInput).not.toBeNull();
    if (!firstInput) return;
    firstInput.value = 'Keep this answer';
    firstInput.dispatchEvent(new Event('input'));
    firstInput.dispatchEvent(new Event('blur'));
    fixture.detectChanges();
    expect(firstInput.dataset['touched']).toBe('true');

    queryClient.setQueryData(['transfer-claim', 'offer-a'], {
      ...transferClaim('transfer-a', ['question-a', 'replacement-question']),
      registrationOption: {
        questions: [
          { id: 'question-a', required: true },
          { id: 'replacement-question', required: false },
        ],
      },
    });
    await vi.waitFor(() => {
      fixture.detectChanges();
      const currentInputs = [
        ...fixture.nativeElement.querySelectorAll('input[data-question-id]'),
      ];
      expect(currentInputs).toHaveLength(2);
      expect(currentInputs[0]?.dataset['questionId']).toBe('question-a');
      expect(currentInputs[0]?.value).toBe('Keep this answer');
      expect(currentInputs[1]?.dataset['questionId']).toBe(
        'replacement-question',
      );
      expect(currentInputs[1]?.value).toBe('');
    });

    fixture.componentRef.setInput('credential', 'offer-b');
    fixture.detectChanges();

    await vi.waitFor(() => {
      fixture.detectChanges();
      const currentInput = answerInput(fixture);
      expect(currentInput?.dataset['questionId']).toBe('question-b');
      expect(currentInput?.value).toBe('');
      expect(currentInput?.dataset['touched']).toBe('false');
    });
  });

  it('clears an unsafe checkout warning before retrying and when the claim leaves checkout', async () => {
    retryCheckoutMutation
      .mockResolvedValueOnce({
        checkoutUrl: 'https://payments.example.test/not-stripe',
        status: 'paymentPending',
      })
      .mockResolvedValueOnce({ status: 'reconciled' });
    const fixture = TestBed.createComponent(RegistrationTransferClaimComponent);
    fixture.componentRef.setInput('credential', 'offer-a');
    fixture.detectChanges();

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(retryCheckoutButton(fixture)).not.toBeNull();
    });

    retryCheckoutButton(fixture)?.click();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(unsafeCheckoutText(fixture)).toContain('true');
    });

    retryCheckoutButton(fixture)?.click();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(unsafeCheckoutText(fixture)).toContain('false');
    });

    retryCheckoutMutation.mockResolvedValueOnce({
      checkoutUrl: 'https://payments.example.test/not-stripe',
      status: 'paymentPending',
    });
    retryCheckoutButton(fixture)?.click();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(unsafeCheckoutText(fixture)).toContain('true');
    });

    queryClient.setQueryData(
      ['transfer-claim', 'offer-a'],
      transferClaim('transfer-a', 'question-a', 'completed'),
    );
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(unsafeCheckoutText(fixture)).toContain('false');
    });

    queryClient.setQueryData(
      ['transfer-claim', 'offer-a'],
      transferClaim('transfer-a', 'question-a'),
    );
    retryCheckoutMutation.mockResolvedValueOnce({
      checkoutUrl: 'https://payments.example.test/not-stripe',
      status: 'paymentPending',
    });
    retryCheckoutButton(fixture)?.click();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(unsafeCheckoutText(fixture)).toContain('true');
    });

    fixture.componentRef.setInput('credential', 'offer-b');
    fixture.detectChanges();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(unsafeCheckoutText(fixture)).toContain('false');
    });
  });

  it('refetches the current transfer after a claim failure', async () => {
    loadClaim
      .mockResolvedValueOnce(transferClaim('transfer-a', 'question-a'))
      .mockResolvedValue(
        transferClaim('transfer-a', 'question-a', 'completed'),
      );
    claimMutation.mockRejectedValueOnce(
      new Error('Registration transfer is no longer available'),
    );
    const fixture = TestBed.createComponent(RegistrationTransferClaimComponent);
    fixture.componentRef.setInput('credential', 'offer-a');
    fixture.detectChanges();

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(answerInput(fixture)).not.toBeNull();
    });

    const input = answerInput(fixture);
    const formElement: HTMLFormElement | null =
      fixture.nativeElement.querySelector('[data-claim-form]');
    expect(input).not.toBeNull();
    expect(formElement).not.toBeNull();
    if (!input || !formElement) return;

    input.value = 'Current answer';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    formElement.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(claimMutation).toHaveBeenCalledOnce();
      expect(loadClaim).toHaveBeenCalledTimes(2);
      expect(
        fixture.nativeElement.querySelector('[data-claim-status]')?.textContent,
      ).toContain('completed');
    });
  });
});

describe('transferClaimFormSchema', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({});
  });

  it('propagates conditional required semantics and rejects blank answers', () => {
    const claimForm = form(
      signal({
        answers: [
          { answer: '', questionId: 'required-question', required: true },
          { answer: '', questionId: 'optional-question', required: false },
        ],
      }),
      transferClaimFormSchema,
      { injector: TestBed.inject(Injector) },
    );

    expect(claimForm.answers[0].answer().required()).toBe(true);
    expect(claimForm.answers[0].answer().errors()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'required',
          message: 'Answer this required question.',
        }),
      ]),
    );
    expect(claimForm.answers[1].answer().required()).toBe(false);
    expect(claimForm.answers[1].answer().errors()).toEqual([]);

    claimForm.answers[0].answer().value.set(' '.repeat(3));
    expect(claimForm.answers[0].answer().invalid()).toBe(true);
    claimForm.answers[0].answer().value.set('Accessibility support requested');
    expect(claimForm.answers[0].answer().errors()).toEqual([]);
  });
});

describe('reconcileTransferClaimAnswers', () => {
  it('preserves answers only for question ids still present in the offer', () => {
    expect(
      reconcileTransferClaimAnswers({
        answers: [
          { answer: 'Keep me', questionId: 'question-a', required: true },
          { answer: 'Remove me', questionId: 'question-old', required: true },
        ],
        questions: [
          { id: 'question-a', required: false },
          { id: 'question-new', required: true },
        ],
      }),
    ).toEqual([
      { answer: 'Keep me', questionId: 'question-a', required: false },
      { answer: '', questionId: 'question-new', required: true },
    ]);
  });
});

describe('registrationTransferClaimPayload', () => {
  it('submits only recipient answers and the claim credential', () => {
    const payload = registrationTransferClaimPayload({
      answers: [
        {
          answer: 'No accessibility needs',
          questionId: 'question-1',
        },
      ],
      credential: 'claim-token',
    });

    expect(payload).toEqual({
      answers: [
        {
          answer: 'No accessibility needs',
          questionId: 'question-1',
        },
      ],
      credential: 'claim-token',
    });
    expect(payload).not.toHaveProperty('addOns');
    expect(payload).not.toHaveProperty('guestCount');
  });
});

describe('registrationTransferCheckoutUrl', () => {
  it('accepts only an exact HTTPS Stripe Checkout host', () => {
    expect(
      registrationTransferCheckoutUrl(
        'https://checkout.stripe.com/c/pay/cs_test_123',
      ),
    ).toBe('https://checkout.stripe.com/c/pay/cs_test_123');
    expect(
      registrationTransferCheckoutUrl(
        'https://checkout.stripe.com.evil.example/cs_test_123',
      ),
    ).toBeUndefined();
    expect(
      registrationTransferCheckoutUrl('javascript:alert(document.domain)'),
    ).toBeUndefined();
  });
});

describe('registrationTransferLookupErrorCopy', () => {
  it('keeps missing and unauthorized credentials indistinguishable', () => {
    const notFound = registrationTransferLookupErrorCopy({
      _tag: 'RegistrationTransferNotFoundError',
    });
    const unauthorized = registrationTransferLookupErrorCopy({
      _tag: 'RegistrationTransferUnauthorizedError',
    });

    expect(notFound).toEqual(unauthorized);
    expect(notFound.retryable).toBe(false);
    expect(notFound.body).toContain('complete code');
  });

  it('offers a retry without exposing internal lookup details', () => {
    const copy = registrationTransferLookupErrorCopy({
      _tag: 'RegistrationTransferInternalError',
      message: 'database connection string leaked here',
    });

    expect(copy.retryable).toBe(true);
    expect(copy.body).toContain('Nothing changed');
    expect(copy.body).not.toContain('database connection');
  });
});

describe('registration transfer bundle review template', () => {
  it('names the loading progress indicator directly', () => {
    const template = readSource(
      'src/app/registration-transfers/registration-transfer-claim.component.html',
    );

    expect(template).toContain(
      '<mat-spinner diameter="40" aria-label="Loading transfer" />',
    );
  });

  it('announces claim progress and renders touched validation errors', () => {
    const template = readSource(
      'src/app/registration-transfers/registration-transfer-claim.component.html',
    );

    expect(template).toContain(
      '[attr.aria-busy]="claimMutation.isPending() || null"',
    );
    expect(template).toContain('Claiming registration. Please wait.');
    expect(template).toContain('answerField.answer().touched()');
    expect(template).toContain('<mat-error>{{ error.message }}</mat-error>');
  });

  it('renders preserved check-in and add-on fulfillment history', () => {
    const template = readSource(
      'src/app/registration-transfers/registration-transfer-claim.component.html',
    );

    expect(template).toContain('Registration check-in');
    expect(template).toContain('claim.bundle.checkInTime | date: "medium"');
    expect(template).toContain('{{ claim.bundle.checkedInGuestCount }} of');
    expect(template).toContain('Available to use');
    expect(template).toContain('{{ addOn.remainingQuantity }}');
    expect(template).toContain('Redeemed');
    expect(template).toContain('{{ addOn.redeemedQuantity }}');
    expect(template).toContain('Cancelled');
    expect(template).toContain('{{ addOn.cancelledQuantity }}');
    expect(template).toContain(
      'existing check-in and use history\n            transfer together',
    );
  });

  it("shows current base price and only the recipient's current discount", () => {
    const template = readSource(
      'src/app/registration-transfers/registration-transfer-claim.component.html',
    );

    expect(template).toContain('Current base price');
    expect(template).toContain('claim.registrationOption.basePrice / 100');
    expect(template).toContain('Your current ESNcard discount');
    expect(template).toContain('claim.registrationOption.discountAmount / 100');
    expect(template).toContain('Your current registration price');
    expect(template).toContain('claim.registrationOption.currentPrice / 100');
    expect(template).not.toContain('sourceDiscount');
  });

  it('keeps included add-ons inside the registration price and prices only purchased units separately', () => {
    const template = readSource(
      'src/app/registration-transfers/registration-transfer-claim.component.html',
    );

    expect(template).toContain(
      'Includes the add-on units marked Included below.',
    );
    expect(template).toContain('Included in registration price');
    expect(template).toContain('{{ addOn.includedQuantity }}');
    expect(template).toContain('Purchased at current unit price');
    expect(template).toContain('{{ addOn.purchasedQuantity }} ×');
    expect(template).toContain('addOn.currentUnitPrice / 100');
    expect(template).not.toContain('{{ addOn.quantity }} total ·');
  });

  it('shows the authoritative bundle total with an explicit free state', () => {
    const template = readSource(
      'src/app/registration-transfers/registration-transfer-claim.component.html',
    );

    expect(template).toContain('Total due');
    expect(template).toContain('claim.recipientBundlePrice === 0');
    expect(template).toContain('claim.recipientBundlePrice / 100');
    expect(template).toContain('Free');
  });

  it('gives an invalid manual code a security-neutral recovery action', () => {
    const template = readSource(
      'src/app/registration-transfers/registration-transfer-claim.component.html',
    );

    expect(template).toContain('role="alert"');
    expect(template).not.toContain('errorMessage(claimQuery.error()');
    expect(template).not.toContain('errorMessage(claimMutation.error()');
    expect(template).not.toContain('errorMessage(retryMutation.error()');
    expect(template).toContain('lookupErrorCopy(claimQuery.error())');
    expect(template).toContain('(click)="claimQuery.refetch()"');
    expect(template).toContain('routerLink="/registration-transfers"');
    expect(template).toContain('Enter another code');
    expect(template).toContain('@if (unsafeCheckout())');
    expect(template).toContain('@else if (retryMutation.isError())');
    expect(template).toContain('Your transfer has not changed');
  });

  it('announces transfer error states as alerts', () => {
    const template = readSource(
      'src/app/registration-transfers/registration-transfer-claim.component.html',
    );

    expect(template).toContain(
      `[attr.role]="state.tone === 'error' ? 'alert' : 'status'"`,
    );
  });
});

describe('registrationTransferStatusCopy', () => {
  it('explains paid-recipient compensation without suggesting another payment', () => {
    const pending = registrationTransferStatusCopy('compensation_pending', {
      state: 'processing',
    });
    const failed = registrationTransferStatusCopy('compensation_failed');
    const completed = registrationTransferStatusCopy('compensated');

    expect(pending?.body).toContain('full refund');
    expect(pending?.body).toContain('including the platform fee');
    expect(failed?.body).toContain('contact the organizer for an update');
    expect(completed?.body).toContain('was refunded');
    for (const copy of [pending, failed, completed]) {
      expect(copy?.body).toContain('Do not pay or claim again');
    }
  });

  it('keeps recipient ownership truthful while a source refund is pending', () => {
    expect(
      registrationTransferStatusCopy('refund_pending', { state: 'processing' }),
    ).toEqual({
      body: 'The fixed registration bundle now belongs to you and remains confirmed. The previous owner refund is still being processed; you do not need to do anything.',
      title: 'Transfer complete — refund processing',
      tone: 'success',
    });
  });

  it('distinguishes refunds needing follow-up from processing', () => {
    const actionRequired = registrationTransferStatusCopy(
      'compensation_pending',
      { state: 'actionRequired' },
    );
    const stopped = registrationTransferStatusCopy('refund_pending', {
      state: 'needsAttention',
    });

    expect(actionRequired?.title).toBe(
      'Transfer stopped — refund needs attention',
    );
    expect(actionRequired?.body).toContain('Do not pay or claim again');
    expect(actionRequired?.body).not.toContain('is processing');
    expect(stopped?.title).toBe('Transfer complete — refund needs attention');
    expect(stopped?.body).toContain('still needs follow-up');
    expect(stopped?.body).not.toContain('platform-administrator');
  });

  it('fails closed when a pending transfer has no refund projection', () => {
    const copy = registrationTransferStatusCopy('refund_pending', null);

    expect(copy?.tone).toBe('error');
    expect(copy?.title).toContain('needs attention');
  });

  it('directs failed refunds to organizer follow-up without asking the participant to retry', () => {
    const copy = registrationTransferStatusCopy('refund_failed');

    expect(copy?.title).toBe('Transfer complete — refund needs attention');
    expect(copy?.body).toContain('you do not need to pay or claim again');
    expect(copy?.body).toContain('previous owner refund still needs follow-up');
    expect(copy?.body).not.toContain('platform administrator');
  });

  it('states that an expired Checkout preserves the source registration', () => {
    expect(registrationTransferStatusCopy('expired')?.body).toContain(
      'previous owner kept their confirmed registration',
    );
  });
});
