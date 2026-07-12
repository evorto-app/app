import type {
  RegistrationTransferRefundLifecycle,
  RegistrationTransferStatus,
} from '@shared/registration-transfer';

import { CurrencyPipe, DatePipe, DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import {
  applyEach,
  form,
  FormField,
  schema,
  submit,
  validate,
} from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { RouterLink } from '@angular/router';
import {
  injectMutation,
  injectQuery,
} from '@tanstack/angular-query-experimental';

import { AppRpc } from '../core/effect-rpc-angular-client';
import { getErrorMessage } from '../core/error-message';

interface TransferClaimAnswerModel {
  answer: string;
  questionId: string;
  required: boolean;
}

interface TransferClaimFormModel {
  answers: TransferClaimAnswerModel[];
}

const answerSchema = schema<TransferClaimAnswerModel>((answer) => {
  validate(answer.answer, ({ value, valueOf }) =>
    valueOf(answer.required) && !value().trim()
      ? { kind: 'required', message: 'Answer this required question.' }
      : undefined,
  );
});

const transferClaimFormSchema = schema<TransferClaimFormModel>((claim) => {
  applyEach(claim.answers, answerSchema);
});

export const registrationTransferClaimPayload = ({
  answers,
  credential,
}: {
  answers: readonly { answer: string; questionId: string }[];
  credential: string;
}) => ({
  answers: answers.map((answer) => ({
    answer: answer.answer,
    questionId: answer.questionId,
  })),
  credential,
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
        body: 'The previous owner cancelled this offer. Their registration was not transferred.',
        title: 'Transfer cancelled',
        tone: 'info',
      };
    }
    case 'checkout_pending': {
      return {
        body: 'Your payment is pending. The fixed ticket bundle stays confirmed for its current owner until payment succeeds. Continue the existing Stripe Checkout; do not start another claim.',
        title: 'Payment still required',
        tone: 'info',
      };
    }
    case 'compensated': {
      return {
        body: 'The transfer could not finish, so the ticket stayed with its previous owner and your full payment, including the platform fee, was refunded. Do not pay or claim again.',
        title: 'Transfer stopped — payment refunded',
        tone: 'info',
      };
    }
    case 'compensation_failed': {
      return {
        body: 'The transfer could not finish, so the ticket stayed with its previous owner. Your full refund needs operator attention. Do not pay or claim again; a platform administrator must requeue the existing refund.',
        title: 'Transfer stopped — refund needs attention',
        tone: 'error',
      };
    }
    case 'compensation_pending': {
      if (refundLifecycle?.state === 'actionRequired') {
        return {
          body: 'The transfer could not finish, so the ticket stayed with its previous owner. Your full refund, including the platform fee, requires provider-side action. Do not pay or claim again; contact the organizer for an update.',
          title: 'Transfer stopped — refund action required',
          tone: 'error',
        };
      }
      if (refundLifecycle?.state === 'succeeded') {
        return {
          body: 'The transfer could not finish, so the ticket stayed with its previous owner and your full payment, including the platform fee, was refunded. Do not pay or claim again.',
          title: 'Transfer stopped — payment refunded',
          tone: 'info',
        };
      }
      if (refundLifecycle?.state !== 'processing') {
        return {
          body: 'The transfer could not finish, so the ticket stayed with its previous owner. Your full refund needs platform-administrator attention. Do not pay or claim again; a platform administrator must review the existing refund before it can continue.',
          title: 'Transfer stopped — refund needs attention',
          tone: 'error',
        };
      }
      return {
        body: 'The transfer could not finish because the original ticket changed after your payment. The ticket stayed with its previous owner, and your full refund, including the platform fee, is processing. Do not pay or claim again.',
        title: 'Transfer stopped — refund processing',
        tone: 'info',
      };
    }
    case 'completed': {
      return {
        body: 'The registration now belongs to you. You can open the event page for your ticket and current registration details.',
        title: 'Transfer complete',
        tone: 'success',
      };
    }
    case 'expired': {
      return {
        body: 'This offer or its Checkout window expired. The previous owner kept their confirmed registration.',
        title: 'Transfer expired',
        tone: 'info',
      };
    }
    case 'open': {
      return null;
    }
    case 'refund_failed': {
      return {
        body: 'The fixed registration bundle now belongs to you, but the previous owner refund needs operator attention. You do not need to pay or claim again; a platform administrator must safely requeue the existing refund.',
        title: 'Transfer complete — refund needs attention',
        tone: 'error',
      };
    }
    case 'refund_pending': {
      if (refundLifecycle?.state === 'actionRequired') {
        return {
          body: 'The fixed registration bundle now belongs to you. The previous owner refund requires provider-side action. You do not need to pay or claim again.',
          title: 'Transfer complete — refund action required',
          tone: 'error',
        };
      }
      if (refundLifecycle?.state === 'succeeded') {
        return {
          body: 'The fixed registration bundle now belongs to you, and the previous owner refund completed.',
          title: 'Transfer complete — refund completed',
          tone: 'success',
        };
      }
      if (refundLifecycle?.state !== 'processing') {
        return {
          body: 'The fixed registration bundle now belongs to you, but the previous owner refund processing stopped and needs platform-administrator attention. You do not need to pay or claim again.',
          title: 'Transfer complete — refund needs attention',
          tone: 'error',
        };
      }
      return {
        body: 'The fixed registration bundle now belongs to you. The previous owner refund is queued and may finish asynchronously.',
        title: 'Transfer complete — refund processing',
        tone: 'success',
      };
    }
  }
};

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CurrencyPipe,
    DatePipe,
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
  public readonly credential = input.required<string>();
  private readonly claimModel = signal<TransferClaimFormModel>({
    answers: [],
  });
  protected readonly claimForm = form(this.claimModel, transferClaimFormSchema);
  private readonly rpc = AppRpc.injectClient();
  protected readonly claimMutation = injectMutation(() =>
    this.rpc.registrationTransfers.claim.mutationOptions(),
  );
  protected readonly claimQuery = injectQuery(() =>
    this.rpc.registrationTransfers.getClaim.queryOptions({
      credential: this.credential(),
    }),
  );
  protected readonly errorMessage = getErrorMessage;
  protected readonly retryMutation = injectMutation(() =>
    this.rpc.registrationTransfers.retryCheckout.mutationOptions(),
  );
  protected readonly statusCopy = registrationTransferStatusCopy;
  protected readonly unsafeCheckout = signal(false);
  private readonly document = inject(DOCUMENT);
  private readonly initializedTransferId = signal<null | string>(null);

  constructor() {
    effect(() => {
      const claim = this.claimQuery.data();
      if (
        !claim ||
        this.claimForm().touched() ||
        this.initializedTransferId() === claim.transferId
      ) {
        return;
      }
      this.claimModel.set({
        answers: claim.registrationOption.questions.map((question) => ({
          answer: '',
          questionId: question.id,
          required: question.required,
        })),
      });
      this.initializedTransferId.set(claim.transferId);
    });
  }

  protected async retryCheckout(): Promise<void> {
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
            credential: this.credential(),
          }),
        );
        if (!this.openCheckout(result.checkoutUrl)) {
          await this.claimQuery.refetch();
        }
      } catch {
        // The mutation retains the typed error and the persisted offer is safe to retry.
      }
    });
  }

  private openCheckout(checkoutUrl: string | undefined): boolean {
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
