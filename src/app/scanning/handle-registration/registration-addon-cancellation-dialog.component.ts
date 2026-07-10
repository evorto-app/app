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
      return 'Refund the eligible payment for the cancelled optional units.';
    }
    case 'noMonetaryRefundRequired': {
      return 'No monetary refund is required because these optional units were free. The result will be recorded as refund not required.';
    }
    case 'none': {
      return 'No optional purchase is eligible for a refund.';
    }
  }
};

export const registrationAddonRefundChoiceTitle = (
  availability: EventsRegistrationAddonRefundAvailability,
): string =>
  availability === 'noMonetaryRefundRequired'
    ? 'Cancel with refund handling (no payment refund)'
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
    ? `Up to ${cancellablePurchasedQuantity} optional ${cancellablePurchasedQuantity === 1 ? 'unit' : 'units'} may have refund handling. Included units are never refunded.`
    : 'Only included units remain. No payment refund applies to them.';

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
          Only unredeemed units can be cancelled. Redeemed units remain on the
          fulfillment record, and included units are never refunded.
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
            {{ data.cancellableQuantity }} unredeemed
            {{ data.cancellableQuantity === 1 ? 'unit' : 'units' }} available
          </mat-hint>
          @if (
            cancellationForm.quantity().touched() &&
            cancellationForm.quantity().invalid()
          ) {
            <mat-error>Choose an available whole-unit quantity.</mat-error>
          }
        </mat-form-field>

        @if (cancellationForm.quantity().valid()) {
          <div
            class="bg-surface-container-low text-on-surface rounded-lg p-3 text-sm"
          >
            <p class="font-medium">
              Selected cancellation:
              {{ selectedAllocation().optionalQuantity }} optional,
              {{ selectedAllocation().includedQuantity }} included.
            </p>
            <p class="text-on-surface-variant mt-1">
              Optional purchased units are cancelled before included units.
              Refund handling applies only to optional quantity.
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
            <legend class="title-small mb-2">Refund handling</legend>
            <mat-radio-group
              class="grid gap-3"
              aria-label="Refund handling"
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
              This cancellation contains only included units and will be
              recorded without a refund.
            </p>
          </div>
        }
      </mat-dialog-content>

      <mat-dialog-actions align="end" class="gap-2">
        <button mat-button mat-dialog-close type="button">Keep units</button>
        <button
          mat-flat-button
          type="submit"
          [disabled]="cancellationForm().invalid()"
        >
          Cancel selected units
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
              kind: 'wholeUnit',
              message: 'Choose an available whole-unit quantity.',
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
