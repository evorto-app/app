import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { RouterLink } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import {
  faPencil,
  faRightFromBracket,
  faTicket,
} from '@fortawesome/duotone-regular-svg-icons';
import {
  injectMutation,
  injectQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { ConfigService } from '../../core/config.service';
import { AppRpc } from '../../core/effect-rpc-angular-client';
import { getErrorMessage } from '../../core/error-message';
import { NotificationService } from '../../core/notification.service';
import {
  EditProfileDialogComponent,
  EditProfileDialogData,
  EditProfileDialogResult,
} from './edit-profile-dialog.component';

export const isBrowsingOutsideHomeTenant = (
  homeTenantId: string | undefined,
  currentTenantId: string | undefined,
): boolean =>
  homeTenantId !== undefined &&
  currentTenantId !== undefined &&
  homeTenantId !== currentTenantId;

export const profileReimbursementReadiness = ({
  iban,
  paypalEmail,
}: {
  iban?: null | string | undefined;
  paypalEmail?: null | string | undefined;
}): string => {
  if (iban && paypalEmail) {
    return 'IBAN and PayPal details added.';
  }
  if (iban) {
    return 'IBAN added.';
  }
  if (paypalEmail) {
    return 'PayPal account added.';
  }
  return 'No reimbursement details added.';
};

export const profileUserAfterEdit = <
  T extends {
    communicationEmail: string;
    firstName: string;
    iban?: null | string | undefined;
    lastName: string;
    paypalEmail?: null | string | undefined;
  },
>(
  user: T,
  result: EditProfileDialogResult,
): T => ({
  ...user,
  communicationEmail: result.communicationEmail,
  firstName: result.firstName,
  iban: result.iban ?? null,
  lastName: result.lastName,
  paypalEmail: result.paypalEmail ?? null,
});

export const profileUpdateErrorMessage = (error: unknown): string =>
  getErrorMessage(error, "We couldn't update your profile. Try again.", [
    'RpcBadRequestError',
  ]);

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FontAwesomeModule, MatButtonModule, RouterLink],
  selector: 'app-user-profile',
  templateUrl: './user-profile.component.html',
})
export class UserProfileComponent {
  private readonly rpc = AppRpc.injectClient();
  protected readonly userQuery = injectQuery(() =>
    this.rpc.users.self.queryOptions(),
  );
  protected readonly profileUser = computed(() =>
    this.userQuery.isSuccess() ? this.userQuery.data() : undefined,
  );
  private readonly config = inject(ConfigService);
  protected readonly browsingOutsideHomeTenant = computed(() => {
    const user = this.profileUser();
    const tenant = this.config.tenantSignal();
    return isBrowsingOutsideHomeTenant(user?.homeTenantId, tenant?.id);
  });
  protected readonly faPencil = faPencil;
  protected readonly faRightFromBracket = faRightFromBracket;
  protected readonly faTicket = faTicket;
  protected readonly profileReimbursementReadiness =
    profileReimbursementReadiness;
  protected readonly setHomeTenantMutation = injectMutation(() =>
    this.rpc.users.setHomeTenant.mutationOptions(),
  );
  protected readonly updateProfileMutation = injectMutation(() =>
    this.rpc.users.updateProfile.mutationOptions(),
  );

  private readonly dialog = inject(MatDialog);
  private readonly notifications = inject(NotificationService);
  private readonly queryClient = inject(QueryClient);

  protected async openEditProfileDialog(): Promise<void> {
    if (this.updateProfileMutation.isPending()) {
      return;
    }

    const user = this.profileUser();
    if (!user) return;
    const dialogReference = this.dialog.open<
      EditProfileDialogComponent,
      EditProfileDialogData,
      EditProfileDialogResult
    >(EditProfileDialogComponent, {
      data: {
        communicationEmail: user.communicationEmail,
        firstName: user.firstName,
        iban: user.iban ?? null,
        lastName: user.lastName,
        paypalEmail: user.paypalEmail ?? null,
      },
      width: '420px',
    });
    const result = await firstValueFrom(dialogReference.afterClosed());
    if (!result) return;
    this.updateProfileMutation.mutate(result, {
      onError: (error) => {
        this.notifications.showError(profileUpdateErrorMessage(error));
      },
      onSuccess: async () => {
        const updatedUser = profileUserAfterEdit(user, result);
        this.queryClient.setQueryData(
          this.rpc.pathKey(['users', 'self']),
          updatedUser,
        );
        this.queryClient.setQueryData(
          this.rpc.pathKey(['users', 'maybeSelf']),
          updatedUser,
        );
        await this.queryClient.invalidateQueries(
          this.rpc.queryFilter(['users', 'self']),
        );
        await this.queryClient.invalidateQueries(
          this.rpc.queryFilter(['users', 'maybeSelf']),
        );
        await this.queryClient.invalidateQueries(
          this.rpc.queryFilter([
            'finance',
            'receipts.refundableGroupedByRecipient',
          ]),
        );
        this.notifications.showSuccess('Profile updated');
      },
    });
  }

  protected setCurrentTenantAsHome(): void {
    if (this.setHomeTenantMutation.isPending()) return;
    const user = this.profileUser();
    if (!user) return;

    this.setHomeTenantMutation.mutate(undefined, {
      onError: (error) => {
        this.notifications.showError(
          getErrorMessage(
            error,
            "We couldn't change your home organization. Try again.",
          ),
        );
      },
      onSuccess: (homeTenant) => {
        const updatedUser = {
          ...user,
          homeTenantId: homeTenant.homeTenantId,
          homeTenantName: homeTenant.homeTenantName,
        };
        this.queryClient.setQueryData(
          this.rpc.pathKey(['users', 'self']),
          updatedUser,
        );
        this.queryClient.setQueryData(
          this.rpc.pathKey(['users', 'maybeSelf']),
          updatedUser,
        );
        this.notifications.showSuccess(
          `${homeTenant.homeTenantName} is now your home organization`,
        );
      },
    });
  }
}
