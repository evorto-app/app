import type { EventReviewStatus } from '@shared/rpc-contracts/app-rpcs/events.rpcs';

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatMenuModule } from '@angular/material/menu';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { IconComponent } from '@app/shared/components/icon/icon.component';
import { Shape } from '@app/shared/components/shape/shape';
import { MaterialThemeDirective } from '@app/shared/directives/material-theme.directive';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import {
  faArrowLeft,
  faEllipsisVertical,
} from '@fortawesome/duotone-regular-svg-icons';
import {
  injectMutation,
  injectQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { convert } from 'html-to-text';
import { firstValueFrom, map } from 'rxjs';

import { ConfigService } from '../../core/config.service';
import { AppRpc } from '../../core/effect-rpc-angular-client';
import { getErrorMessage } from '../../core/error-message';
import { NotificationService } from '../../core/notification.service';
import { PermissionsService } from '../../core/permissions.service';
import { EventStatusComponent } from '../../shared/components/event-status/event-status.component';
import { PriceWithTaxComponent } from '../../shared/components/inclusive-price-label/price-with-tax.component';
import { IfAnyPermissionDirective } from '../../shared/directives/if-any-permission.directive';
import { EventActiveRegistrationComponent } from '../event-active-registration/event-active-registration.component';
import { EventRegistrationOptionComponent } from '../event-registration-option/event-registration-option.component';
import { EventReviewDialogComponent } from '../event-review-dialog/event-review-dialog.component';
import { SubmitEventDialogComponent } from '../submit-event-dialog/submit-event-dialog.component';
import { UpdateVisibilityDialogComponent } from '../update-visibility-dialog/update-visibility-dialog.component';

export type RegistrationOptionsState =
  | 'hiddenByEligibility'
  | 'none'
  | 'visible';

export const registrationOptionsState = (event: {
  registrationOptions: readonly unknown[];
  registrationOptionsHiddenByEligibility: boolean;
}): RegistrationOptionsState => {
  if (event.registrationOptions.length > 0) {
    return 'visible';
  }
  return event.registrationOptionsHiddenByEligibility
    ? 'hiddenByEligibility'
    : 'none';
};

export const eventReviewActionDisabled = ({
  canReview,
  mutationPending,
  status,
}: {
  canReview: boolean;
  mutationPending: boolean;
  status: EventReviewStatus;
}): boolean => !canReview || status !== 'PENDING_REVIEW' || mutationPending;

export const eventSubmitForReviewActionDisabled = ({
  canEdit,
  mutationPending,
  status,
}: {
  canEdit: boolean;
  mutationPending: boolean;
  status: EventReviewStatus;
}): boolean =>
  !canEdit || (status !== 'DRAFT' && status !== 'REJECTED') || mutationPending;

export const eventListingActionDisabled = ({
  eventLoaded,
  mutationPending,
}: {
  eventLoaded: boolean;
  mutationPending: boolean;
}): boolean => !eventLoaded || mutationPending;

export const eventAddonPurchaseTiming = (addOn: {
  allowPurchaseBeforeEvent: boolean;
  allowPurchaseDuringEvent: boolean;
  allowPurchaseDuringRegistration: boolean;
}): string => {
  const windows = [
    addOn.allowPurchaseDuringRegistration ? 'During registration' : null,
    addOn.allowPurchaseBeforeEvent ? 'Before event' : null,
    addOn.allowPurchaseDuringEvent ? 'During event' : null,
  ].filter((window): window is string => window !== null);

  return windows.length > 0 ? windows.join(', ') : 'Unavailable';
};

export const transferCodeRedemptionActionDisabled = ({
  hasTransferCode,
  isRegistered,
  mutationPending,
}: {
  hasTransferCode: boolean;
  isRegistered: boolean;
  mutationPending: boolean;
}): boolean => !hasTransferCode || isRegistered || mutationPending;

export const eventRegistrationOptionTitle = (
  event: {
    registrationOptions: readonly { id: string; title: string }[];
  },
  registrationOptionId: string,
): string =>
  event.registrationOptions.find((option) => option.id === registrationOptionId)
    ?.title ?? 'Unknown registration option';

export const eventAddonsForRegistrationOption = <
  TAddOn extends {
    allowPurchaseDuringRegistration: boolean;
    registrationOptions: readonly { registrationOptionId: string }[];
  },
>(
  event: {
    addOns: readonly TAddOn[];
  },
  registrationOptionId: string,
) =>
  event.addOns.filter(
    (addOn) =>
      addOn.allowPurchaseDuringRegistration &&
      addOn.registrationOptions.some(
        (option) => option.registrationOptionId === registrationOptionId,
      ),
  );

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatMenuModule,
    RouterLink,
    FontAwesomeModule,
    EventRegistrationOptionComponent,
    EventActiveRegistrationComponent,
    EventStatusComponent,
    IfAnyPermissionDirective,
    Shape,
    IconComponent,
    MaterialThemeDirective,
    PriceWithTaxComponent,
  ],
  styles: ``,
  templateUrl: './event-details.component.html',
})
export class EventDetailsComponent {
  public eventId = input.required<string>();
  private readonly rpc = AppRpc.injectClient();
  protected readonly eventQuery = injectQuery(() =>
    this.rpc.events.findOne.queryOptions({ id: this.eventId() }),
  );
  protected readonly selfQery = injectQuery(() =>
    this.rpc.users.maybeSelf.queryOptions(),
  );
  private permissions = inject(PermissionsService);
  protected readonly canEdit = computed(() => {
    const event = this.eventQuery.data();
    if (!event || (event.status !== 'DRAFT' && event.status !== 'REJECTED')) {
      return false;
    }
    const editAllPermission =
      this.permissions.hasPermission('events:editAll')();
    if (editAllPermission) {
      return true;
    }
    const self = this.selfQery.data();
    if (!self) {
      return false;
    }
    return event.creatorId === self.id;
  });
  protected readonly canOrganizeQuery = injectQuery(() =>
    this.rpc.events.canOrganize.queryOptions({ eventId: this.eventId() }),
  );
  protected readonly canOrganize = computed(() => {
    return this.canOrganizeQuery.isSuccess()
      ? this.canOrganizeQuery.data()
      : false;
  });
  protected readonly canReview =
    this.permissions.hasPermission('events:review');
  protected readonly canSeeStatus = computed(() => {
    const canReview = this.permissions.hasPermission('events:review')();
    const canEdit = this.canEdit();
    const canSeeDrafts = this.permissions.hasPermission('events:seeDrafts')();
    return canReview || canEdit || canSeeDrafts;
  });
  protected readonly myCardsQuery = injectQuery(() =>
    this.rpc.discounts.getMyCards.queryOptions(),
  );
  private readonly config = inject(ConfigService);
  protected readonly cardExpiresBeforeEvent = computed(() => {
    const esnCardEnabled =
      this.config.tenant.discountProviders?.esnCard?.status === 'enabled';
    if (!esnCardEnabled) return false;
    if (!this.eventQuery.isSuccess() || !this.myCardsQuery.isSuccess()) {
      return false;
    }
    const event = this.eventQuery.data();
    const cards = this.myCardsQuery.data();
    const verified = cards.filter((c) => c.status === 'verified');
    if (verified.length === 0) return false;
    const latestValidTo = verified
      .map((card) => (card.validTo ? new Date(card.validTo) : undefined))
      .filter((date): date is Date => !!date && !Number.isNaN(date.getTime()))
      .toSorted((a, b) => b.getTime() - a.getTime())[0];
    if (!latestValidTo) return false;
    return latestValidTo <= new Date(event.start);
  });
  protected readonly eventAddonPurchaseTiming = eventAddonPurchaseTiming;
  protected readonly eventAddonsForRegistrationOption =
    eventAddonsForRegistrationOption;

  protected readonly eventIconColor = computed(() => {
    const event = this.eventQuery.data();
    if (!event) {
      return;
    }
    return event.icon.iconColor;
  });
  protected readonly eventListingActionDisabled = eventListingActionDisabled;
  protected readonly eventReviewActionDisabled = eventReviewActionDisabled;
  protected readonly eventSubmitForReviewActionDisabled =
    eventSubmitForReviewActionDisabled;
  protected readonly faArrowLeft = faArrowLeft;
  protected readonly faEllipsisVertical = faEllipsisVertical;
  protected readonly registerWithTransferCodeMutation = injectMutation(() =>
    this.rpc.events.registerWithTransferCode.mutationOptions(),
  );
  protected readonly registrationOptionsState = computed(() => {
    const event = this.eventQuery.data();
    return event ? registrationOptionsState(event) : 'none';
  });
  protected readonly registrationOptionTitle = eventRegistrationOptionTitle;
  protected readonly registrationStatusQuery = injectQuery(() =>
    this.rpc.events.getRegistrationStatus.queryOptions({
      eventId: this.eventId(),
    }),
  );
  protected readonly reviewMutation = injectMutation(() =>
    this.rpc.events.reviewEvent.mutationOptions(),
  );
  protected readonly submitForReviewMutation = injectMutation(() =>
    this.rpc.events.submitForReview.mutationOptions(),
  );
  private readonly route = inject(ActivatedRoute);
  protected readonly transferCode = toSignal(
    this.route.queryParamMap.pipe(
      map((parameters) => parameters.get('transferCode')?.trim() || null),
    ),
    {
      initialValue:
        this.route.snapshot.queryParamMap.get('transferCode')?.trim() || null,
    },
  );
  protected readonly transferCodeRedemptionActionDisabled =
    transferCodeRedemptionActionDisabled;
  protected readonly updateListingMutation = injectMutation(() =>
    this.rpc.events.updateListing.mutationOptions(),
  );
  private dialog = inject(MatDialog);
  private notifications = inject(NotificationService);
  private queryClient = inject(QueryClient);

  constructor() {
    effect(() => {
      const event = this.eventQuery.data();
      if (event) {
        this.config.updateTitle(event.title);
        this.config.updateDescription(convert(event.description));
      }
    });
  }

  async updateVisibility() {
    const event = this.eventQuery.data();
    if (
      eventListingActionDisabled({
        eventLoaded: !!event,
        mutationPending: this.updateListingMutation.isPending(),
      }) ||
      !event
    ) {
      return;
    }

    const unlisted = await firstValueFrom(
      this.dialog
        .open(UpdateVisibilityDialogComponent, {
          data: { event },
        })
        .afterClosed(),
    );
    if (unlisted !== null && unlisted !== undefined) {
      this.updateListingMutation.mutate(
        {
          eventId: this.eventId(),
          unlisted,
        },
        {
          onSuccess: async () => {
            await this.refreshReviewState();
          },
        },
      );
    }
  }

  protected eventAddonTaxRate(addOn: {
    taxRateDisplayName: null | string;
    taxRatePercentage: null | string;
  }) {
    return addOn.taxRateDisplayName && addOn.taxRatePercentage
      ? {
          displayName: addOn.taxRateDisplayName,
          percentage: addOn.taxRatePercentage,
        }
      : undefined;
  }

  protected redeemTransferCode() {
    const transferCode = this.transferCode();
    if (
      transferCodeRedemptionActionDisabled({
        hasTransferCode: !!transferCode,
        isRegistered: this.registrationStatusQuery.isSuccess()
          ? this.registrationStatusQuery.data().isRegistered
          : false,
        mutationPending: this.registerWithTransferCodeMutation.isPending(),
      }) ||
      !transferCode
    ) {
      return;
    }

    this.registerWithTransferCodeMutation.mutate(
      {
        code: transferCode,
        eventId: this.eventId(),
      },
      {
        onSuccess: async () => {
          await this.registrationStatusQuery.refetch();
          await this.queryClient.invalidateQueries({
            queryKey: this.rpc.events.findOne.queryKey({
              id: this.eventId(),
            }),
          });
        },
      },
    );
  }

  protected async reviewEvent(approved: boolean): Promise<void> {
    const event = this.eventQuery.data();
    if (
      !event ||
      eventReviewActionDisabled({
        canReview: this.canReview(),
        mutationPending: this.reviewMutation.isPending(),
        status: event.status,
      })
    ) {
      return;
    }

    try {
      if (approved) {
        await this.reviewMutation.mutateAsync({
          approved,
          eventId: this.eventId(),
        });
        await this.refreshReviewState();
        const event = this.eventQuery.data();
        if (event) {
          this.notifications.showEventReviewed(approved, event.title);
        }
      } else {
        const dialogReference = this.dialog.open(EventReviewDialogComponent);
        const comment = await firstValueFrom(dialogReference.afterClosed());

        if (comment) {
          await this.reviewMutation.mutateAsync({
            approved,
            comment,
            eventId: this.eventId(),
          });
          await this.refreshReviewState();
          const event = this.eventQuery.data();
          if (event) {
            this.notifications.showEventReviewed(approved, event.title);
          }
        }
      }
    } catch (error) {
      await this.handleReviewActionError(error);
    }
  }

  protected async submitForReview(): Promise<void> {
    const event = this.eventQuery.data();
    if (
      !event ||
      eventSubmitForReviewActionDisabled({
        canEdit: this.canEdit(),
        mutationPending: this.submitForReviewMutation.isPending(),
        status: event.status,
      })
    ) {
      return;
    }

    try {
      const dialogReference = this.dialog.open(SubmitEventDialogComponent);
      const confirmed = await firstValueFrom(dialogReference.afterClosed());

      if (confirmed) {
        await this.submitForReviewMutation.mutateAsync({
          eventId: this.eventId(),
        });
        await this.refreshReviewState();
        const event = this.eventQuery.data();
        if (event) {
          this.notifications.showEventSubmitted(event.title);
        }
      }
    } catch (error) {
      await this.handleReviewActionError(error);
    }
  }

  protected transferCodeErrorMessage(error: unknown): string {
    return getErrorMessage(error, 'Transfer code registration failed');
  }

  private async handleReviewActionError(error: unknown): Promise<void> {
    const message = getErrorMessage(
      error,
      'Failed to update event review status',
    );
    const normalizedMessage = message.toLowerCase();
    if (
      normalizedMessage.includes('status changed') ||
      normalizedMessage.includes('refresh and try again') ||
      normalizedMessage.includes('no longer pending review') ||
      normalizedMessage.includes('conflict')
    ) {
      this.notifications.showError(
        'Event status changed. Refreshed the latest state.',
      );
      await this.refreshReviewState();
      return;
    }
    this.notifications.showError(message);
  }

  private async refreshReviewState(): Promise<void> {
    await this.queryClient.invalidateQueries({
      queryKey: this.rpc.events.findOne.queryKey({ id: this.eventId() }),
    });
    await this.queryClient.invalidateQueries(
      this.rpc.queryFilter(['events', 'eventList']),
    );
    await this.queryClient.invalidateQueries(
      this.rpc.queryFilter(['events', 'getPendingReviews']),
    );
  }
}
