import type { EventsRegistrationAddonRefundAvailability } from '@shared/rpc-contracts/app-rpcs/events.rpcs';

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
  max,
  maxLength,
  min,
  required,
  submit,
  validate,
} from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatRadioModule } from '@angular/material/radio';

export interface RegistrationAddonCancellationDialogData {
  addOnTitle: string;
  cancellablePurchasedQuantity: number;
  cancellableQuantity: number;
  refundAvailability: EventsRegistrationAddonRefundAvailability;
}

export interface RegistrationAddonCancellationDialogResult {
  quantity: number;
  reason: string;
  refundRequested: boolean;
}

interface RegistrationAddonCancellationModel {
  quantity: number;
  reason: string;
  refundChoice: '' | 'noRefund' | 'refund';
}

export const registrationAddonRefundChoiceDescription = (
  availability: EventsRegistrationAddonRefundAvailability,
): string => {
  switch (availability) {
    case 'monetaryRefundAvailable': {
      return 'The amount paid for the cancelled items bought separately can be refunded.';
    }
    case 'noMonetaryRefundRequired': {
      return 'These items were bought separately for free, so there is nothing to refund.';
    }
    case 'none': {
      return 'These items bought separately cannot be refunded.';
    }
  }
};

export const registrationAddonRefundChoiceTitle = (
  availability: EventsRegistrationAddonRefundAvailability,
): string =>
  availability === 'noMonetaryRefundRequired'
    ? 'Cancel free items'
    : 'Cancel with refund';

export const registrationAddonCancellationAllocation = ({
  cancellablePurchasedQuantity,
  quantity,
}: {
  cancellablePurchasedQuantity: number;
  quantity: number;
}): { includedQuantity: number; optionalQuantity: number } => {
  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    return { includedQuantity: 0, optionalQuantity: 0 };
  }

  const optionalQuantity = Math.min(quantity, cancellablePurchasedQuantity);
  return {
    includedQuantity: quantity - optionalQuantity,
    optionalQuantity,
  };
};

export const registrationAddonRefundQuantityDescription = (
  cancellablePurchasedQuantity: number,
): string =>
  cancellablePurchasedQuantity > 0
    ? `Up to ${cancellablePurchasedQuantity} ${cancellablePurchasedQuantity === 1 ? 'item' : 'items'} bought separately can be refunded. Items included with the ticket cannot be refunded.`
    : 'Only items included with the ticket remain. They cannot be refunded.';

export const registrationAddonCancellationResult = ({
  cancellablePurchasedQuantity,
  maxQuantity,
  model,
}: {
  cancellablePurchasedQuantity: number;
  maxQuantity: number;
  model: RegistrationAddonCancellationModel;
}): RegistrationAddonCancellationDialogResult | undefined => {
  const reason = model.reason.trim();
  if (
    !Number.isSafeInteger(model.quantity) ||
    model.quantity < 1 ||
    model.quantity > maxQuantity ||
    reason.length === 0 ||
    reason.length > 500 ||
    (cancellablePurchasedQuantity > 0 && model.refundChoice === '')
  ) {
    return;
  }

  return {
    quantity: model.quantity,
    reason,
    refundRequested:
      cancellablePurchasedQuantity > 0 && model.refundChoice === 'refund',
  };
};

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormField,
    MatButtonModule,
    MatDialogActions,
    MatDialogClose,
    MatDialogContent,
    MatDialogTitle,
    MatFormFieldModule,
    MatInputModule,
    MatRadioModule,
  ],
  selector: 'app-registration-addon-cancellation-dialog',
  template: `
    <h2 mat-dialog-title>Cancel {{ data.addOnTitle }}</h2>
    <form (submit)="onSubmit($event)">
      <mat-dialog-content class="grid gap-4">
        <p class="text-on-surface-variant">
          Only unused items can be cancelled. Items already used stay on the
          ticket. Items included with the ticket cannot be refunded.
        </p>

        <mat-form-field appearance="outline" class="w-full">
          <mat-label>Quantity to cancel</mat-label>
          <input
            matInput
            type="number"
            inputmode="numeric"
            step="1"
            [formField]="cancellationForm.quantity"
          />
          <mat-hint>
            {{ data.cancellableQuantity }} unused
            {{ data.cancellableQuantity === 1 ? 'item' : 'items' }} available
          </mat-hint>
          @if (
            cancellationForm.quantity().touched() &&
            cancellationForm.quantity().invalid()
          ) {
            <mat-error>
              Enter a whole number from 1 to {{ data.cancellableQuantity }}.
            </mat-error>
          }
        </mat-form-field>

        @if (cancellationForm.quantity().valid()) {
          <div
            class="bg-surface-container-low text-on-surface rounded-lg p-3 text-sm"
          >
            <p class="font-medium">
              You are cancelling:
              {{ selectedAllocation().optionalQuantity }} bought separately,
              {{ selectedAllocation().includedQuantity }} included with the
              ticket.
            </p>
            <p class="text-on-surface-variant mt-1">
              Items bought separately are cancelled first and can be refunded.
              Items included with the ticket cannot be refunded.
            </p>
          </div>
        }

        <p class="text-on-surface-variant text-sm">
          {{ refundQuantityDescription }}
        </p>

        <mat-form-field appearance="outline" class="w-full">
          <mat-label>Cancellation reason</mat-label>
          <textarea
            matInput
            rows="3"
            autocomplete="off"
            [formField]="cancellationForm.reason"
          ></textarea>
          @if (
            cancellationForm.reason().touched() &&
            cancellationForm.reason().invalid()
          ) {
            <mat-error>
              {{
                cancellationForm.reason().errors()[0].message ??
                  'Enter a reason for the cancellation.'
              }}
            </mat-error>
          }
        </mat-form-field>

        @if (refundChoiceAvailable) {
          <fieldset class="border-outline-variant grid gap-2 border-t pt-4">
            <legend class="title-small mb-2">Refund</legend>
            <mat-radio-group
              class="grid gap-3"
              aria-label="Refund"
              [formField]="cancellationForm.refundChoice"
            >
              <mat-radio-button value="refund">
                <span class="grid py-1">
                  <span>{{ refundChoiceTitle }}</span>
                  <span class="text-on-surface-variant text-sm">
                    {{ refundChoiceDescription }}
                  </span>
                </span>
              </mat-radio-button>
              <mat-radio-button value="noRefund">
                Cancel without a refund
              </mat-radio-button>
            </mat-radio-group>
            @if (
              cancellationForm.refundChoice().touched() &&
              cancellationForm.refundChoice().invalid()
            ) {
              <p class="text-error text-sm" role="alert">
                Choose whether to request a refund.
              </p>
            }
          </fieldset>
        } @else {
          <div
            class="bg-surface-container-low text-on-surface rounded-lg p-3 text-sm"
          >
            <p class="font-medium">No refund applies.</p>
            <p class="text-on-surface-variant mt-1">
              Only items included with the ticket are being cancelled, so there
              is no refund.
            </p>
          </div>
        }
      </mat-dialog-content>

      <mat-dialog-actions align="end" class="gap-2">
        <button mat-button mat-dialog-close type="button">Keep items</button>
        <button
          mat-flat-button
          type="submit"
          [disabled]="cancellationForm().invalid()"
        >
          Cancel selected items
        </button>
      </mat-dialog-actions>
    </form>
  `,
})
export class RegistrationAddonCancellationDialogComponent {
  protected readonly data =
    inject<RegistrationAddonCancellationDialogData>(MAT_DIALOG_DATA);
  private readonly cancellationModel =
    signal<RegistrationAddonCancellationModel>({
      quantity: 1,
      reason: '',
      refundChoice:
        this.data.cancellablePurchasedQuantity > 0 ? '' : 'noRefund',
    });
  protected readonly cancellationForm = form(
    this.cancellationModel,
    (schema) => {
      min(schema.quantity, 1);
      max(schema.quantity, this.data.cancellableQuantity);
      validate(schema.quantity, ({ value }) =>
        Number.isSafeInteger(value())
          ? undefined
          : {
              kind: 'wholeNumber',
              message: `Enter a whole number from 1 to ${this.data.cancellableQuantity}.`,
            },
      );
      required(schema.reason);
      maxLength(schema.reason, 500, {
        message: 'Keep the cancellation reason within 500 characters.',
      });
      validate(schema.reason, ({ value }) =>
        value().trim().length === 0
          ? { kind: 'required', message: 'Cancellation reason is required.' }
          : undefined,
      );
      required(schema.refundChoice);
    },
  );
  protected readonly refundChoiceAvailable =
    this.data.cancellablePurchasedQuantity > 0;
  protected readonly refundChoiceDescription =
    registrationAddonRefundChoiceDescription(this.data.refundAvailability);
  protected readonly refundChoiceTitle = registrationAddonRefundChoiceTitle(
    this.data.refundAvailability,
  );
  protected readonly refundQuantityDescription =
    registrationAddonRefundQuantityDescription(
      this.data.cancellablePurchasedQuantity,
    );
  protected readonly selectedAllocation = computed(() =>
    registrationAddonCancellationAllocation({
      cancellablePurchasedQuantity: this.data.cancellablePurchasedQuantity,
      quantity: this.cancellationModel().quantity,
    }),
  );
  private readonly dialogReference = inject(
    MatDialogRef<
      RegistrationAddonCancellationDialogComponent,
      RegistrationAddonCancellationDialogResult
    >,
  );

  protected async onSubmit(event: Event): Promise<void> {
    event.preventDefault();
    await submit(this.cancellationForm, async () => {
      const result = registrationAddonCancellationResult({
        cancellablePurchasedQuantity: this.data.cancellablePurchasedQuantity,
        maxQuantity: this.data.cancellableQuantity,
        model: this.cancellationModel(),
      });
      if (result) {
        this.dialogReference.close(result);
      }
    });
  }
}
