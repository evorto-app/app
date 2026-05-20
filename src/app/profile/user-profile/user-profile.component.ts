import type { FinanceReceiptStatus } from '@shared/rpc-contracts/app-rpcs/finance.rpcs';

import { DatePipe } from '@angular/common';
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

import type { User } from '../../../types/custom/user';

import { AppRpc } from '../../core/effect-rpc-angular-client';
import { getErrorMessage } from '../../core/error-message';
import { NotificationService } from '../../core/notification.service';
import {
  EditProfileDialogComponent,
  EditProfileDialogData,
  EditProfileDialogResult,
} from './edit-profile-dialog.component';

type EsnCardMutationAction = 'refresh' | 'remove' | 'save';

type ProfileSection = 'discounts' | 'events' | 'overview' | 'receipts';

const esnCardFallbackMessages = {
  refresh: 'Could not refresh ESN card',
  remove: 'Could not remove ESN card',
  save: 'Could not validate ESN card',
} as const satisfies Record<EsnCardMutationAction, string>;

export const esnCardMutationErrorMessage = (
  action: EsnCardMutationAction,
  error: unknown,
): string => getErrorMessage(error, esnCardFallbackMessages[action]);

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

export const esnCardActionLabel = (
  action: EsnCardMutationAction,
  pending: boolean,
): string => {
  switch (action) {
    case 'refresh': {
      return pending ? 'Refreshing...' : 'Refresh';
    }
    case 'remove': {
      return pending ? 'Removing...' : 'Remove';
    }
    case 'save': {
      return pending ? 'Checking ESN card...' : 'Save ESN card';
    }
  }
};

export const esnCardSaveDisabled = ({
  formInvalid,
  formSubmitting,
  mutationPending,
}: {
  formInvalid: boolean;
  formSubmitting: boolean;
  mutationPending: boolean;
}): boolean => formInvalid || formSubmitting || mutationPending;

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
  if (event.paymentState === 'pending' && event.checkoutUrl) {
    return 'Finish the checkout payment to confirm your spot.';
  }

  return null;
};

export const profileEventContinuePaymentUrl = (event: {
  checkoutUrl: null | string;
  paymentState: 'cancelled' | 'notRequired' | 'pending' | 'recorded';
}): null | string => {
  if (event.paymentState !== 'pending') {
    return null;
  }

  return event.checkoutUrl;
};

export const profileEventActionNote = (event: {
  checkoutUrl: null | string;
  paymentState: 'cancelled' | 'notRequired' | 'pending' | 'recorded';
  status: 'CONFIRMED' | 'PENDING' | 'WAITLIST';
}): string => {
  if (event.paymentState === 'pending' && event.checkoutUrl) {
    return 'Continue payment from this card, or open the event page for registration details. Cancellation after confirmation is handled on the event page.';
  }

  switch (event.status) {
    case 'CONFIRMED': {
      return 'Open the event page for ticket access and participant cancellation when the event still allows it. Automatic refunds and self-service transfer/resale are not available yet.';
    }
    case 'PENDING': {
      return 'Open the event page for pending-registration details and available cancellation actions. Self-service transfer/resale is not available yet.';
    }
    case 'WAITLIST': {
      return 'Open the event page for waitlist details and the leave-waitlist action. Transfer/resale is not available for waitlist registrations.';
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

export const profileReceiptAmountLabel = (totalAmount: number): string =>
  `${(totalAmount / 100).toFixed(2)} €`;

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

export const esnCardSubmitPayloadFromIdentifier = (
  identifier: string,
): { identifier: string; type: 'esnCard' } => ({
  identifier: identifier.trim(),
  type: 'esnCard',
});

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    FontAwesomeModule,
    FormField,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
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
  protected readonly discountProvidersQuery = injectQuery(() =>
    this.rpc.discounts.getTenantProviders.queryOptions(),
  );
  protected readonly buyEsnCardUrl = computed(() => {
    const providers = this.discountProvidersQuery.data();
    if (!providers) return;
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
  protected readonly esnCardActionLabel = esnCardActionLabel;
  protected readonly esnCardErrorMessage = signal<null | string>(null);
  private readonly esnCardModel = signal({ identifier: '' });
  protected readonly esnCardForm = form(this.esnCardModel, (schemaPath) => {
    required(schemaPath.identifier);
    pattern(schemaPath.identifier, /^[A-Za-z0-9]{8,16}$/);
  });
  protected readonly esnCardSaveDisabled = esnCardSaveDisabled;
  protected readonly esnEnabled = computed(() => {
    const providers = this.discountProvidersQuery.data();
    if (!providers) return false;
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
    const cards = this.myCardsQuery.data();
    if (!cards) return false;
    return cards.some(
      (card) => card.type === 'esnCard' && card.status === 'verified',
    );
  });
  protected readonly myReceiptsQuery = injectQuery(() =>
    this.rpc.finance.receipts.my.queryOptions(),
  );

  protected readonly profileEventActionNote = profileEventActionNote;
  protected readonly profileEventContinuePaymentUrl =
    profileEventContinuePaymentUrl;
  protected readonly profileEventDetailActionLabel =
    profileEventDetailActionLabel;
  protected readonly profileEventGuestLabel = profileEventGuestLabel;
  protected readonly profileEventNextStepLabel = profileEventNextStepLabel;
  protected readonly profileReceiptAmountLabel = profileReceiptAmountLabel;
  protected readonly profileReceiptStatusLabel = profileReceiptStatusLabel;
  protected readonly userQuery = injectQuery(() =>
    this.rpc.users.self.queryOptions(),
  );

  private readonly profileUserOverride = signal<null | User>(null);
  protected readonly profileUser = computed(
    () => this.profileUserOverride() ?? this.userQuery.data(),
  );
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
        this.profileUserOverride.set(updatedUser);
        this.queryClient.setQueryData(
          this.rpc.pathKey(['users', 'self']),
          updatedUser,
        );
        this.queryClient.setQueryData(
          this.rpc.pathKey(['users', 'maybeSelf']),
          updatedUser,
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

  protected setSelectedSection(section: ProfileSection): void {
    this.selectedSection.set(section);
  }
}
