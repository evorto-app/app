import type { FinanceReceiptStatus } from '@shared/rpc-contracts/app-rpcs/finance.rpcs';

import { CurrencyPipe, DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import {
  form,
  FormField,
  pattern,
  required,
  submit,
} from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import {
  faCalendarDays,
  faPencil,
  faReceipt,
  faRightFromBracket,
  faTags,
  faUser,
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
import { ReceiptAmountPipe } from '../../finance/shared/receipt-amount.pipe';
import {
  EditProfileDialogComponent,
  EditProfileDialogData,
  EditProfileDialogResult,
} from './edit-profile-dialog.component';
import {
  esnCardActionDisabled,
  esnCardActionLabel,
  esnCardMutationErrorMessage,
  esnCardSaveDisabled,
  esnCardStatusLabel,
  esnCardSubmitPayloadFromIdentifier,
} from './user-profile.esn-card';

type ProfileSection = 'discounts' | 'events' | 'overview' | 'receipts';

export const profileEditActionDisabled = ({
  mutationPending,
}: {
  mutationPending: boolean;
}): boolean => mutationPending;

export const isBrowsingOutsideHomeTenant = (
  homeTenantId: string | undefined,
  currentTenantId: string | undefined,
): boolean =>
  homeTenantId !== undefined &&
  currentTenantId !== undefined &&
  homeTenantId !== currentTenantId;

export const profileUserAfterEdit = <
  T extends {
    communicationEmail?: null | string | undefined;
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
  communicationEmail: result.communicationEmail?.trim() || null,
  firstName: result.firstName,
  iban: result.iban ?? null,
  lastName: result.lastName,
  paypalEmail: result.paypalEmail ?? null,
});

export const profileEventDetailActionLabel = (): string => 'Open event page';

export const profileEventGuestLabel = (guestCount: number): null | string => {
  if (guestCount <= 0) {
    return null;
  }

  return guestCount === 1
    ? 'Includes 1 guest'
    : `Includes ${guestCount} guests`;
};

export const profileEventNextStepLabel = (event: {
  checkoutUrl: null | string;
  paymentState: 'cancelled' | 'notRequired' | 'pending' | 'recorded';
}): null | string => {
  if (profileEventContinuePaymentUrl(event)) {
    return 'Finish the checkout payment to confirm your spot.';
  }

  if (event.paymentState === 'pending') {
    return 'Your payment link is being prepared. Refresh shortly or open the event page for the latest status.';
  }

  return null;
};

export const isStripeCheckoutUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'checkout.stripe.com';
  } catch {
    return false;
  }
};

export const profileEventContinuePaymentUrl = (event: {
  checkoutUrl: null | string;
  paymentState: 'cancelled' | 'notRequired' | 'pending' | 'recorded';
}): null | string => {
  if (
    event.paymentState !== 'pending' ||
    !event.checkoutUrl ||
    !isStripeCheckoutUrl(event.checkoutUrl)
  ) {
    return null;
  }

  return event.checkoutUrl;
};

export const profileEventActionNote = (event: {
  checkInTime?: null | string;
  checkoutUrl: null | string;
  paymentState: 'cancelled' | 'notRequired' | 'pending' | 'recorded';
  status: 'CONFIRMED' | 'PENDING' | 'WAITLIST';
}): string => {
  if (profileEventContinuePaymentUrl(event)) {
    return 'Continue payment from this card, or open the event page for registration details.';
  }

  switch (event.status) {
    case 'CONFIRMED': {
      if (event.checkInTime) {
        return 'You are checked in. Open the event page for ticket details. Cancellation and transfer are no longer available after check-in.';
      }

      return 'Open the event page for ticket access, participant cancellation, and unpaid self-service transfer when available.';
    }
    case 'PENDING': {
      if (event.paymentState === 'pending') {
        return 'Payment setup is still in progress. Open the event page for the latest payment link or to cancel the registration.';
      }
      return 'Open the event page for pending-registration details and available cancellation actions.';
    }
    case 'WAITLIST': {
      return 'Open the event page for waitlist details and the leave-waitlist action.';
    }
  }
};

export const registrationPaymentLabel = (
  paymentState: 'cancelled' | 'notRequired' | 'pending' | 'recorded',
): string => {
  switch (paymentState) {
    case 'cancelled': {
      return 'Payment cancelled';
    }
    case 'notRequired': {
      return 'No payment required';
    }
    case 'pending': {
      return 'Payment pending';
    }
    case 'recorded': {
      return 'Payment recorded';
    }
  }
};

export const registrationStatusLabel = (
  status: 'CONFIRMED' | 'PENDING' | 'WAITLIST',
): string => {
  switch (status) {
    case 'CONFIRMED': {
      return 'Confirmed';
    }
    case 'PENDING': {
      return 'Pending';
    }
    case 'WAITLIST': {
      return 'Waitlist';
    }
  }
};

export const profileReceiptStatusLabel = (
  status: FinanceReceiptStatus,
): string => {
  switch (status) {
    case 'approved': {
      return 'Approved';
    }
    case 'refunded': {
      return 'Reimbursed';
    }
    case 'rejected': {
      return 'Rejected';
    }
    case 'submitted': {
      return 'Submitted';
    }
  }
};

export const profileSectionFromFragment = (
  fragment: null | string,
  esnEnabled: boolean,
): ProfileSection => {
  if (fragment === 'discounts' && esnEnabled) {
    return 'discounts';
  }

  if (fragment === 'events') {
    return 'events';
  }

  if (fragment === 'receipts') {
    return 'receipts';
  }

  return 'overview';
};

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    CurrencyPipe,
    FontAwesomeModule,
    FormField,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    ReceiptAmountPipe,
    RouterLink,
  ],
  selector: 'app-user-profile',
  styles: ``,
  templateUrl: './user-profile.component.html',
})
export class UserProfileComponent {
  protected readonly allSectionEntries: {
    icon: typeof faUser;
    key: ProfileSection;
    label: string;
  }[] = [
    { icon: faUser, key: 'overview', label: 'Overview' },
    { icon: faCalendarDays, key: 'events', label: 'Events' },
    { icon: faTags, key: 'discounts', label: 'Discounts' },
    { icon: faReceipt, key: 'receipts', label: 'Receipts' },
  ];
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
  protected readonly discountProvidersQuery = injectQuery(() =>
    this.rpc.discounts.getTenantProviders.queryOptions(),
  );
  protected readonly buyEsnCardUrl = computed(() => {
    if (!this.discountProvidersQuery.isSuccess()) return;
    const providers = this.discountProvidersQuery.data();
    const esnProvider = providers.find(
      (provider) => provider.type === 'esnCard',
    );
    const buyEsnCardUrl = esnProvider?.config.buyEsnCardUrl?.trim();
    return buyEsnCardUrl && buyEsnCardUrl.length > 0
      ? buyEsnCardUrl
      : undefined;
  });
  protected readonly deleteCardMutation = injectMutation(() =>
    this.rpc.discounts.deleteMyCard.mutationOptions(),
  );
  protected readonly esnCardActionDisabled = esnCardActionDisabled;
  protected readonly esnCardActionLabel = esnCardActionLabel;
  protected readonly esnCardErrorMessage = signal<null | string>(null);
  private readonly esnCardModel = signal({ identifier: '' });
  protected readonly esnCardForm = form(this.esnCardModel, (schemaPath) => {
    required(schemaPath.identifier);
    pattern(schemaPath.identifier, /^[A-Za-z0-9]{8,16}$/);
  });
  protected readonly esnCardSaveDisabled = esnCardSaveDisabled;
  protected readonly esnCardStatusLabel = esnCardStatusLabel;
  protected readonly esnEnabled = computed(() => {
    if (!this.discountProvidersQuery.isSuccess()) return false;
    const providers = this.discountProvidersQuery.data();
    return providers.find((p) => p.type === 'esnCard')?.status === 'enabled';
  });
  protected readonly faCalendarDays = faCalendarDays;
  protected readonly faPencil = faPencil;
  protected readonly faReceipt = faReceipt;
  protected readonly faRightFromBracket = faRightFromBracket;

  protected readonly faTags = faTags;
  protected readonly faUser = faUser;

  protected readonly myCardsQuery = injectQuery(() =>
    this.rpc.discounts.getMyCards.queryOptions(),
  );
  protected readonly hasVerifiedEsnCard = computed(() => {
    if (!this.myCardsQuery.isSuccess()) return false;
    const cards = this.myCardsQuery.data();
    return cards.some(
      (card) => card.type === 'esnCard' && card.status === 'verified',
    );
  });
  protected readonly myReceiptsQuery = injectQuery(() =>
    this.rpc.finance.receipts.my.queryOptions(),
  );
  protected readonly profileEditActionDisabled = profileEditActionDisabled;
  protected readonly profileEventActionNote = profileEventActionNote;
  protected readonly profileEventContinuePaymentUrl =
    profileEventContinuePaymentUrl;
  protected readonly profileEventDetailActionLabel =
    profileEventDetailActionLabel;
  protected readonly profileEventGuestLabel = profileEventGuestLabel;

  protected readonly profileEventNextStepLabel = profileEventNextStepLabel;
  protected readonly profileReceiptStatusLabel = profileReceiptStatusLabel;
  protected readonly refreshCardMutation = injectMutation(() =>
    this.rpc.discounts.refreshMyCard.mutationOptions(),
  );
  protected readonly registrationPaymentLabel = registrationPaymentLabel;
  protected readonly registrationStatusLabel = registrationStatusLabel;
  protected readonly sectionEntries = computed(() =>
    this.allSectionEntries.filter(
      (section) => section.key !== 'discounts' || this.esnEnabled(),
    ),
  );
  protected readonly selectedSection = signal<ProfileSection>('overview');
  protected readonly setHomeTenantMutation = injectMutation(() =>
    this.rpc.users.setHomeTenant.mutationOptions(),
  );
  protected readonly updateProfileMutation = injectMutation(() =>
    this.rpc.users.updateProfile.mutationOptions(),
  );
  protected readonly upsertCardMutation = injectMutation(() =>
    this.rpc.discounts.upsertMyCard.mutationOptions(),
  );
  protected readonly userEventsQuery = injectQuery(() =>
    this.rpc.users.events.queryOptions(),
  );

  private readonly dialog = inject(MatDialog);
  private readonly notifications = inject(NotificationService);

  private readonly queryClient = inject(QueryClient);

  private readonly route = inject(ActivatedRoute);

  private readonly routeFragment = signal<null | string>(null);

  constructor() {
    effect(() => {
      if (this.routeFragment() === 'discounts') {
        this.selectedSection.set(
          profileSectionFromFragment(this.routeFragment(), this.esnEnabled()),
        );
      }
    });

    this.route.fragment.subscribe((fragment) => {
      this.routeFragment.set(fragment);
      this.selectedSection.set(
        profileSectionFromFragment(fragment, this.esnEnabled()),
      );
    });
  }

  protected deleteEsnCard(): void {
    if (this.esnCardMutationPending()) {
      return;
    }

    this.esnCardErrorMessage.set(null);
    this.deleteCardMutation.mutate(
      { type: 'esnCard' },
      {
        onError: (error) => {
          this.esnCardErrorMessage.set(
            esnCardMutationErrorMessage('remove', error),
          );
        },
        onSuccess: async () => {
          await this.queryClient.invalidateQueries(
            this.rpc.queryFilter(['discounts', 'getMyCards']),
          );
          this.esnCardErrorMessage.set(null);
          this.notifications.showSuccess('ESN card removed');
        },
      },
    );
  }

  protected async openEditProfileDialog(): Promise<void> {
    if (
      profileEditActionDisabled({
        mutationPending: this.updateProfileMutation.isPending(),
      })
    ) {
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
        communicationEmail: user.communicationEmail ?? user.email,
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
        const errorMessage = getErrorMessage(error, 'Failed to update profile');
        this.notifications.showError(
          'Failed to update profile: ' + errorMessage,
        );
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
        this.notifications.showSuccess('Profile updated successfully');
      },
    });
  }
  protected refreshEsnCard(): void {
    if (this.esnCardMutationPending()) {
      return;
    }

    this.esnCardErrorMessage.set(null);
    this.refreshCardMutation.mutate(
      { type: 'esnCard' },
      {
        onError: (error) => {
          this.esnCardErrorMessage.set(
            esnCardMutationErrorMessage('refresh', error),
          );
        },
        onSuccess: async () => {
          await this.queryClient.invalidateQueries(
            this.rpc.queryFilter(['discounts', 'getMyCards']),
          );
          this.esnCardErrorMessage.set(null);
          this.notifications.showSuccess('ESN card refreshed');
        },
      },
    );
  }
  protected async saveEsnCard(event: Event): Promise<void> {
    event.preventDefault();
    if (this.esnCardMutationPending()) {
      return;
    }

    this.esnCardErrorMessage.set(null);
    await submit(this.esnCardForm, async (formState) => {
      this.upsertCardMutation.mutate(
        esnCardSubmitPayloadFromIdentifier(formState().value().identifier),
        {
          onError: (error) => {
            this.esnCardErrorMessage.set(
              esnCardMutationErrorMessage('save', error),
            );
          },
          onSuccess: async () => {
            await this.queryClient.invalidateQueries(
              this.rpc.queryFilter(['discounts', 'getMyCards']),
            );
            this.esnCardModel.set({ identifier: '' });
            this.esnCardErrorMessage.set(null);
            this.notifications.showSuccess('ESN card saved');
          },
        },
      );
    });
  }

  protected sectionButtonClasses(section: ProfileSection): string {
    if (this.selectedSection() === section) {
      return 'bg-secondary-container text-on-secondary-container';
    }
    return 'bg-surface text-on-surface';
  }

  protected setCurrentTenantAsHome(): void {
    if (this.setHomeTenantMutation.isPending()) return;
    const user = this.profileUser();
    if (!user) return;

    this.setHomeTenantMutation.mutate(undefined, {
      onError: (error) => {
        this.notifications.showError(
          getErrorMessage(error, 'Failed to change home tenant'),
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
          `${homeTenant.homeTenantName} is now your home tenant`,
        );
      },
    });
  }

  protected setSelectedSection(section: ProfileSection): void {
    this.selectedSection.set(section);
  }

  private esnCardMutationPending(): boolean {
    return esnCardActionDisabled({
      deletePending: this.deleteCardMutation.isPending(),
      refreshPending: this.refreshCardMutation.isPending(),
      upsertPending: this.upsertCardMutation.isPending(),
    });
  }
}
