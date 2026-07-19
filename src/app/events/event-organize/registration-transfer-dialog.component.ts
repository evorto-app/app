import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  Injectable,
  Injector,
  signal,
  viewChild,
} from '@angular/core';
import { debounce, form, FormField } from '@angular/forms/signals';
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
import { injectQuery } from '@tanstack/angular-query-experimental';

import { AppRpc } from '../../core/effect-rpc-angular-client';
import { ReceiptAmountPipe } from '../../finance/shared/receipt-amount.pipe';

export interface RegistrationTransferDialogData {
  readonly currentUser: {
    readonly email: string;
    readonly firstName: string;
    readonly lastName: string;
  };
  readonly eventId: string;
  readonly registrationId: string;
}

export interface RegistrationTransferDialogResult {
  readonly previewVersion: string;
  readonly targetUserId: string;
}

export const transferParticipantLabel = (participant: {
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
}) => `${participant.firstName} ${participant.lastName} (${participant.email})`;

interface RegistrationTransferPreviewQueryInput {
  readonly eventId: string;
  readonly registrationId: string;
  readonly targetUserId: string;
}

interface RegistrationTransferTarget {
  readonly email: string;
  readonly firstName: string;
  readonly id: string;
  readonly lastName: string;
}

interface RegistrationTransferTargetQueryInput {
  readonly eventId: string;
  readonly registrationId: string;
  readonly search: string;
}

@Injectable({ providedIn: 'root' })
export class RegistrationTransferDialogOperations {
  private readonly rpc = AppRpc.injectClient();

  findTransferTargets(input: RegistrationTransferTargetQueryInput) {
    return this.rpc.events.findTransferTargets.queryOptions(input);
  }

  previewTransfer(input: RegistrationTransferPreviewQueryInput) {
    return this.rpc.events.previewEventRegistrationTransfer.queryOptions(input);
  }
}

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
    ReceiptAmountPipe,
  ],
  selector: 'app-registration-transfer-dialog',
  templateUrl: './registration-transfer-dialog.component.html',
})
export class RegistrationTransferDialogComponent {
  protected readonly data =
    inject<RegistrationTransferDialogData>(MAT_DIALOG_DATA);
  protected readonly currentParticipantLabel = computed(() =>
    transferParticipantLabel(this.data.currentUser),
  );
  protected readonly searchModel = signal({ query: '' });
  protected readonly searchForm = form(this.searchModel, (schema) => {
    debounce(schema, 300);
  });
  protected readonly searchValue = computed(
    () => this.searchForm().value().query,
  );
  protected readonly selectedTarget = signal<null | RegistrationTransferTarget>(
    null,
  );

  private readonly operations = inject(RegistrationTransferDialogOperations);
  protected readonly transferPreviewQuery = injectQuery(() => {
    const target = this.selectedTarget();
    return {
      ...this.operations.previewTransfer({
        eventId: this.data.eventId,
        registrationId: this.data.registrationId,
        targetUserId: target?.id ?? '__none__',
      }),
      enabled: target !== null,
    };
  });
  protected readonly transferTargetsQuery = injectQuery(() =>
    this.operations.findTransferTargets({
      eventId: this.data.eventId,
      registrationId: this.data.registrationId,
      search: this.searchValue(),
    }),
  );
  private readonly cancelButton = viewChild<
    HTMLButtonElement,
    ElementRef<HTMLButtonElement>
  >('cancelButton', { read: ElementRef });

  private readonly dialogRef = inject(
    MatDialogRef<
      RegistrationTransferDialogComponent,
      RegistrationTransferDialogResult
    >,
  );

  private readonly injector = inject(Injector);

  protected chooseAnotherTarget(): void {
    this.selectedTarget.set(null);
  }

  protected confirmTransfer(): void {
    const target = this.selectedTarget();
    const preview = this.transferPreviewQuery.data();
    if (!target || !preview) {
      return;
    }

    this.dialogRef.close({
      previewVersion: preview.previewVersion,
      targetUserId: target.id,
    });
  }

  protected selectTarget(target: RegistrationTransferTarget): void {
    this.selectedTarget.set(target);
    afterNextRender(
      {
        write: () => this.cancelButton()?.nativeElement?.focus(),
      },
      { injector: this.injector },
    );
  }
}
