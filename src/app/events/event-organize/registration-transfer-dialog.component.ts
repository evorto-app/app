import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
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

export interface RegistrationTransferDialogData {
  currentUser: {
    email: string;
    firstName: string;
    lastName: string;
  };
  eventId: string;
  registrationId: string;
}

export interface RegistrationTransferDialogResult {
  targetUserId: string;
}

export const transferParticipantLabel = (participant: {
  email: string;
  firstName: string;
  lastName: string;
}) => `${participant.firstName} ${participant.lastName} (${participant.email})`;

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

  private readonly rpc = AppRpc.injectClient();

  protected readonly transferTargetsQuery = injectQuery(() =>
    this.rpc.events.findTransferTargets.queryOptions({
      eventId: this.data.eventId,
      registrationId: this.data.registrationId,
      search: this.searchValue(),
    }),
  );

  private readonly dialogRef = inject(
    MatDialogRef<
      RegistrationTransferDialogComponent,
      RegistrationTransferDialogResult
    >,
  );

  protected transferTo(targetUserId: string): void {
    this.dialogRef.close({ targetUserId });
  }
}
