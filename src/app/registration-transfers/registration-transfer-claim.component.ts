import type {
  RegistrationTransferRefundLifecycle,
  RegistrationTransferStatus,
} from '@shared/registration-transfer';

import { CurrencyPipe, DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  Injectable,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import {
  applyEach,
  form,
  FormField,
  maxLength,
  required,
  schema,
  submit,
  validate,
} from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { RouterLink } from '@angular/router';
import { MAX_REGISTRATION_ANSWER_LENGTH } from '@shared/registration-question-limits';
import {
  injectMutation,
  injectQuery,
} from '@tanstack/angular-query-experimental';

import { AppRpc } from '../core/effect-rpc-angular-client';
import { TenantDatePipe } from '../core/tenant-date.pipe';

interface TransferClaimAnswerModel {
  answer: string;
  questionId: string;
  required: boolean;
}

interface TransferClaimFormModel {
  answers: TransferClaimAnswerModel[];
}

export const reconcileTransferClaimAnswers = ({
  answers,
  questions,
}: {
  answers: readonly TransferClaimAnswerModel[];
  questions: readonly { id: string; required: boolean }[];
}): TransferClaimAnswerModel[] =>
  questions.map((question) => ({
    answer:
      answers.find((answer) => answer.questionId === question.id)?.answer ?? '',
    questionId: question.id,
    required: question.required,
  }));

const answerSchema = schema<TransferClaimAnswerModel>((answer) => {
  required(answer.answer, {
    message: 'Answer this required question.',
    when: ({ valueOf }) => valueOf(answer.required),
  });
  maxLength(answer.answer, MAX_REGISTRATION_ANSWER_LENGTH, {
    message: `Answers must be ${MAX_REGISTRATION_ANSWER_LENGTH} characters or fewer.`,
  });
  validate(answer.answer, ({ value, valueOf }) => {
    const answerValue = value();
    return valueOf(answer.required) && answerValue && !answerValue.trim()
      ? { kind: 'required', message: 'Answer this required question.' }
      : undefined;
  });
});

export const transferClaimFormSchema = schema<TransferClaimFormModel>(
  (claim) => {
    applyEach(claim.answers, answerSchema);
  },
);

export const registrationTransferClaimPayload = ({
  answers,
  claimCode,
}: {
  answers: readonly { answer: string; questionId: string }[];
  claimCode: string;
}) => ({
  answers: answers.map((answer) => ({
    answer: answer.answer,
    questionId: answer.questionId,
  })),
  claimCode,
});

export const registrationTransferCheckoutUrl = (
  value: string | undefined,
): string | undefined => {
  if (!value) return;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'checkout.stripe.com'
      ? url.toString()
      : undefined;
  } catch {
    return;
  }
};

export const registrationTransferLookupErrorCopy = (
  error: unknown,
): {
  body: string;
  retryable: boolean;
  title: string;
} => {
  const tag =
    typeof error === 'object' && error !== null && '_tag' in error
      ? error._tag
      : null;
  if (
    tag === 'RegistrationTransferNotFoundError' ||
    tag === 'RegistrationTransferUnauthorizedError'
  ) {
    return {
      body: 'We could not open a transfer with this code. Check the complete code and try again, or ask the sender for the current code.',
      retryable: false,
      title: 'Transfer could not be opened',
    };
  }

  return {
    body: 'We could not load the latest transfer details. Nothing changed. Try again, or enter another code.',
    retryable: true,
    title: 'Transfer details could not be loaded',
  };
};

export const registrationTransferStatusCopy = (
  status: RegistrationTransferStatus,
  refundLifecycle: null | RegistrationTransferRefundLifecycle = null,
): null | {
  body: string;
  title: string;
  tone: 'error' | 'info' | 'success';
} => {
  switch (status) {
    case 'cancelled': {
      return {
        body: 'The sender cancelled the transfer. The ticket was not transferred.',
        title: 'Transfer cancelled',
        tone: 'info',
      };
    }
    case 'checkout_pending': {
      return {
        body: 'Your payment is pending. The ticket remains with the previous attendee until payment is complete. Continue the same payment; do not start again.',
        title: 'Payment still required',
        tone: 'info',
      };
    }
    case 'compensated': {
      return {
        body: 'The transfer could not finish, so the ticket stayed with the previous attendee and your full payment, including all fees, was refunded. Do not pay or try the transfer again.',
        title: 'Transfer stopped — payment refunded',
        tone: 'info',
      };
    }
    case 'compensation_failed': {
      return {
        body: 'The transfer could not finish, so the ticket stayed with the previous attendee. Your full refund needs attention and may not have reached you. Do not pay or try the transfer again; contact the organizer for an update.',
        title: 'Transfer stopped — refund needs attention',
        tone: 'error',
      };
    }
    case 'compensation_pending': {
      if (refundLifecycle?.state === 'actionRequired') {
        return {
          body: 'The transfer could not finish, so the ticket stayed with the previous attendee. Your full refund, including all fees, needs attention. Do not pay or try the transfer again; contact the organizer for an update.',
          title: 'Transfer stopped — refund needs attention',
          tone: 'error',
        };
      }
      if (refundLifecycle?.state === 'succeeded') {
        return {
          body: 'The transfer could not finish, so the ticket stayed with the previous attendee and your full payment, including all fees, was refunded. Do not pay or try the transfer again.',
          title: 'Transfer stopped — payment refunded',
          tone: 'info',
        };
      }
      if (refundLifecycle?.state !== 'processing') {
        return {
          body: 'The transfer could not finish, so the ticket stayed with the previous attendee. Your full refund needs attention and may not have reached you. Do not pay or try the transfer again; contact the organizer for an update.',
          title: 'Transfer stopped — refund needs attention',
          tone: 'error',
        };
      }
      return {
        body: 'The transfer could not finish because the ticket details changed after your payment. The ticket stayed with the previous attendee, and your full refund, including all fees, is in progress. Do not pay or try the transfer again.',
        title: 'Transfer stopped — refund in progress',
        tone: 'info',
      };
    }
    case 'completed': {
      return {
        body: 'The ticket is now yours and confirmed. Open the event page to see its details.',
        title: 'Transfer complete',
        tone: 'success',
      };
    }
    case 'expired': {
      return {
        body: 'This private transfer or its payment link expired. The previous attendee kept the ticket.',
        title: 'Transfer expired',
        tone: 'info',
      };
    }
    case 'open': {
      return null;
    }
    case 'refund_failed': {
      return {
        body: 'The ticket is now yours and confirmed. A refund for the previous attendee still needs attention; you do not need to pay or try the transfer again.',
        title: 'Transfer complete — refund needs attention',
        tone: 'error',
      };
    }
    case 'refund_pending': {
      if (refundLifecycle?.state === 'actionRequired') {
        return {
          body: 'The ticket is now yours and confirmed. A refund for the previous attendee still needs attention; you do not need to pay or try the transfer again.',
          title: 'Transfer complete — refund needs attention',
          tone: 'error',
        };
      }
      if (refundLifecycle?.state === 'succeeded') {
        return {
          body: "The ticket is now yours and confirmed. The previous attendee's refund is complete.",
          title: 'Transfer complete — refund completed',
          tone: 'success',
        };
      }
      if (refundLifecycle?.state !== 'processing') {
        return {
          body: 'The ticket is now yours and confirmed. A refund for the previous attendee still needs attention; you do not need to pay or try the transfer again.',
          title: 'Transfer complete — refund needs attention',
          tone: 'error',
        };
      }
      return {
        body: "The ticket is now yours and confirmed. The previous attendee's refund is in progress; you do not need to do anything.",
        title: 'Transfer complete — refund in progress',
        tone: 'success',
      };
    }
  }
};

@Injectable({ providedIn: 'root' })
export class RegistrationTransferClaimOperations {
  private readonly rpc = AppRpc.injectClient();

  claim() {
    return this.rpc.registrationTransfers.claim.mutationOptions();
  }

  getClaim(claimCode: string) {
    return this.rpc.registrationTransfers.getClaim.queryOptions({ claimCode });
  }

  retryCheckout() {
    return this.rpc.registrationTransfers.retryCheckout.mutationOptions();
  }
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CurrencyPipe,
    TenantDatePipe,
    FormField,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressSpinnerModule,
    RouterLink,
  ],
  selector: 'app-registration-transfer-claim',
  templateUrl: './registration-transfer-claim.component.html',
})
export class RegistrationTransferClaimComponent {
  public readonly claimCode = input.required<string>();
  public readonly enterAnotherCode = output();
  private readonly claimModel = signal<TransferClaimFormModel>({
    answers: [],
  });
  protected readonly claimForm = form(this.claimModel, transferClaimFormSchema);
  private readonly operations = inject(RegistrationTransferClaimOperations);
  protected readonly claimMutation = injectMutation(() =>
    this.operations.claim(),
  );
  protected readonly claimQuery = injectQuery(() =>
    this.operations.getClaim(this.claimCode()),
  );
  protected readonly lookupErrorCopy = registrationTransferLookupErrorCopy;
  protected readonly maxRegistrationAnswerLength =
    MAX_REGISTRATION_ANSWER_LENGTH;
  protected readonly retryMutation = injectMutation(() =>
    this.operations.retryCheckout(),
  );
  protected readonly statusCopy = registrationTransferStatusCopy;
  protected readonly unsafeCheckout = signal(false);
  private readonly document = inject(DOCUMENT);
  private readonly initializedQuestionsKey = signal<null | string>(null);
  private readonly initializedTransferId = signal<null | string>(null);

  constructor() {
    effect(() => {
      this.claimCode();
      this.unsafeCheckout.set(false);
    });
    effect(() => {
      const claim = this.claimQuery.data();
      if (claim?.status !== 'checkout_pending') {
        this.unsafeCheckout.set(false);
      }
      if (!claim) return;
      const questionsKey = JSON.stringify(
        claim.registrationOption.questions.map((question) => [
          question.id,
          question.required,
        ]),
      );
      const sameTransfer = this.initializedTransferId() === claim.transferId;
      if (sameTransfer && this.initializedQuestionsKey() === questionsKey) {
        return;
      }
      untracked(() => {
        this.claimForm().reset({
          answers: reconcileTransferClaimAnswers({
            answers: sameTransfer ? this.claimModel().answers : [],
            questions: claim.registrationOption.questions,
          }),
        });
        this.initializedTransferId.set(claim.transferId);
        this.initializedQuestionsKey.set(questionsKey);
      });
    });
  }

  protected async retryCheckout(): Promise<void> {
    this.unsafeCheckout.set(false);
    const claim = this.claimQuery.data();
    if (!claim || this.retryMutation.isPending()) return;
    try {
      const result = await this.retryMutation.mutateAsync({
        transferId: claim.transferId,
      });
      if (!this.openCheckout(result.checkoutUrl)) {
        await this.claimQuery.refetch();
      }
    } catch {
      // The mutation retains the typed error for the persistent recovery UI.
    }
  }

  protected async submitClaim(event: Event): Promise<void> {
    event.preventDefault();
    this.unsafeCheckout.set(false);
    if (
      this.claimForm().invalid() ||
      this.claimForm().submitting() ||
      this.claimMutation.isPending()
    ) {
      return;
    }
    await submit(this.claimForm, async (formState) => {
      const value = formState().value();
      try {
        const result = await this.claimMutation.mutateAsync(
          registrationTransferClaimPayload({
            answers: value.answers,
            claimCode: this.claimCode(),
          }),
        );
        if (!this.openCheckout(result.checkoutUrl)) {
          await this.claimQuery.refetch();
        }
      } catch {
        // A concurrent claim, cancellation, or terms change can make the cached
        // offer stale, so recovery must render the server's current state.
        await this.claimQuery.refetch();
      }
    });
  }

  private openCheckout(checkoutUrl: string | undefined): boolean {
    this.unsafeCheckout.set(false);
    if (!checkoutUrl) return false;
    const safeUrl = registrationTransferCheckoutUrl(checkoutUrl);
    if (!safeUrl) {
      this.unsafeCheckout.set(true);
      return false;
    }
    this.document.location.assign(safeUrl);
    return true;
  }
}
