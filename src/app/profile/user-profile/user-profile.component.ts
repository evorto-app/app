import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
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
import { RpcUnauthorizedError } from '@shared/errors/rpc-errors';
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
  type EditProfileSaveOutcome,
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

export const profileUpdateErrorMessage = (error: unknown): string => {
  if (error instanceof RpcUnauthorizedError) {
    return 'Your profile was not changed. Sign in again and complete your organization setup before saving. Your entries are still here.';
  }
  return getErrorMessage(
    error,
    "We couldn't confirm whether your profile was saved. Open your profile in another tab to check before trying again. Your entries are still here.",
    ['RpcBadRequestError'],
  );
};

export const profileTransferClaimPath = '/registration-transfers';

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
  protected readonly profileDialogOpen = signal(false);
  protected readonly profileReimbursementReadiness =
    profileReimbursementReadiness;
  protected readonly profileTransferClaimPath = profileTransferClaimPath;
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
    if (this.profileDialogOpen() || this.updateProfileMutation.isPending())
      return;
    const user = this.profileUser();
    if (!user) return;

    this.profileDialogOpen.set(true);
    try {
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
          save: async (result): Promise<EditProfileSaveOutcome> => {
            try {
              await this.updateProfileMutation.mutateAsync(result);
            } catch (error) {
              return {
                message: profileUpdateErrorMessage(error),
                saved: false,
              };
            }

            try {
              this.queryClient.setQueryData<typeof user>(
                this.rpc.users.self.queryOptions().queryKey,
                (currentUser) =>
                  currentUser?.id === user.id
                    ? profileUserAfterEdit(currentUser, result)
                    : undefined,
              );
              this.queryClient.setQueryData<null | typeof user>(
                this.rpc.users.maybeSelf.queryOptions().queryKey,
                (currentUser) =>
                  currentUser?.id === user.id
                    ? profileUserAfterEdit(currentUser, result)
                    : undefined,
              );
              const filters = [
                this.rpc.queryFilter(['users', 'self']),
                this.rpc.queryFilter(['users', 'maybeSelf']),
                this.rpc.queryFilter([
                  'finance',
                  'receipts',
                  'refundableGroupedByRecipient',
                ]),
              ];
              const reads = filters.map(async (filter) => {
                const invalidation = this.queryClient.invalidateQueries(
                  filter,
                  { throwOnError: true },
                );
                const activeReads = this.queryClient
                  .getQueryCache()
                  .findAll({ ...filter, type: 'active' })
                  .filter(
                    (query) =>
                      !query.isDisabled() &&
                      !query.isStatic() &&
                      query.state.fetchStatus === 'fetching',
                  )
                  .map((query) => query.promise);
                const results = await Promise.allSettled([
                  invalidation,
                  ...activeReads,
                ]);
                const failures: unknown[] = [];
                for (const settled of results) {
                  if (settled.status === 'rejected')
                    failures.push(settled.reason);
                }
                if (failures.length > 0)
                  throw new AggregateError(
                    failures,
                    'Profile follow-up reads failed',
                  );
              });
              const results = await Promise.allSettled(reads);
              const failures: unknown[] = [];
              for (const settled of results) {
                if (settled.status === 'rejected')
                  failures.push(settled.reason);
              }
              if (failures.length > 0)
                throw new AggregateError(
                  failures,
                  'Profile follow-up reads failed',
                );
            } catch {
              return {
                message:
                  'Your profile was saved, but the latest information could not be loaded. Close this dialog and load your profile again to see the saved details.',
                saved: true,
              };
            }
            this.notifications.showSuccess('Profile updated');
            return { saved: true };
          },
        },
        width: '420px',
      });
      await firstValueFrom(dialogReference.afterClosed());
    } finally {
      this.profileDialogOpen.set(false);
    }
  }

  protected setCurrentTenantAsHome(): void {
    if (this.setHomeTenantMutation.isPending()) return;
    const user = this.profileUser();
    if (!user) return;

    this.setHomeTenantMutation.mutate(undefined, {
      onError: (error) => {
        this.notifications.showError(
          error instanceof RpcUnauthorizedError
            ? 'Your home organization was not changed. Sign in again and check your membership in this organization before trying again.'
            : "We couldn't confirm whether your home organization changed. Open your profile in another tab and check your home organization before trying again.",
        );
      },
      onSuccess: (homeTenant) => {
        this.queryClient.setQueryData<typeof user>(
          this.rpc.users.self.queryOptions().queryKey,
          (currentUser) =>
            currentUser?.id === user.id
              ? {
                  ...currentUser,
                  homeTenantId: homeTenant.homeTenantId,
                  homeTenantName: homeTenant.homeTenantName,
                }
              : undefined,
        );
        this.queryClient.setQueryData<null | typeof user>(
          this.rpc.users.maybeSelf.queryOptions().queryKey,
          (currentUser) =>
            currentUser?.id === user.id
              ? {
                  ...currentUser,
                  homeTenantId: homeTenant.homeTenantId,
                  homeTenantName: homeTenant.homeTenantName,
                }
              : undefined,
        );
        this.notifications.showSuccess(
          `${homeTenant.homeTenantName} is now your home organization`,
        );
      },
    });
  }
}
