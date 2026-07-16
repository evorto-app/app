import type {
  EventReviewStatus,
  EventsOutgoingRegistrationTransferRecord,
} from '@shared/rpc-contracts/app-rpcs/events.rpcs';

import { CurrencyPipe } from '@angular/common';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  Injectable,
  input,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatMenuModule } from '@angular/material/menu';
import { RouterLink } from '@angular/router';
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
import { firstValueFrom } from 'rxjs';

import { ConfigService } from '../../core/config.service';
import { AppRpc } from '../../core/effect-rpc-angular-client';
import { getErrorMessage } from '../../core/error-message';
import { NotificationService } from '../../core/notification.service';
import { PermissionsService } from '../../core/permissions.service';
import { TenantDatePipe } from '../../core/tenant-date.pipe';
import { EventStatusComponent } from '../../shared/components/event-status/event-status.component';
import { PriceWithTaxComponent } from '../../shared/components/inclusive-price-label/price-with-tax.component';
import { IfAnyPermissionDirective } from '../../shared/directives/if-any-permission.directive';
import { EventActiveRegistrationComponent } from '../event-active-registration/event-active-registration.component';
import { EventRegistrationOptionComponent } from '../event-registration-option/event-registration-option.component';
import { EventReviewDialogComponent } from '../event-review-dialog/event-review-dialog.component';
import { SubmitEventDialogComponent } from '../submit-event-dialog/submit-event-dialog.component';
import { UpdateVisibilityDialogComponent } from '../update-visibility-dialog/update-visibility-dialog.component';

export type RegistrationOptionsState =
  'hiddenByEligibility' | 'none' | 'visible';

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

export const outgoingRegistrationTransferCopy = (
  transfer: Pick<EventsOutgoingRegistrationTransferRecord, 'refundStatus'>,
): {
  nextStep: string;
  summary: string;
  title: string;
  tone: 'error' | 'info' | 'success';
} => {
  switch (transfer.refundStatus) {
    case 'completed': {
      return {
        nextStep: 'No action is needed.',
        summary:
          'This transfer moved the ticket to its recipient, and all refunds due to you completed.',
        title: 'Transfer refund completed',
        tone: 'success',
      };
    }
    case 'needsAttention': {
      return {
        nextStep:
          'Contact an organizer for an update. Do not pay or register again to retry the refund.',
        summary:
          'This transfer moved the ticket to its recipient, but one or more refunds due to you may not have reached you.',
        title: 'Transfer refund needs attention',
        tone: 'error',
      };
    }
    case 'notRequired': {
      return {
        nextStep: 'No action is needed.',
        summary:
          'This transfer moved the ticket to its recipient. No refund was due for this transfer.',
        title: 'Ticket transfer completed',
        tone: 'success',
      };
    }
    case 'processing': {
      return {
        nextStep:
          'No action is needed. Do not pay or register again to retry the refund.',
        summary:
          'This transfer moved the ticket to its recipient, and one or more refunds due to you are being processed.',
        title: 'Transfer refund is processing',
        tone: 'info',
      };
    }
  }
};

export const eventRegistrationOptionGroups = <
  TOption extends { organizingRegistration: boolean },
>(
  registrationOptions: readonly TOption[],
): {
  organizerOptions: readonly TOption[];
  participantOptions: readonly TOption[];
} => ({
  organizerOptions: registrationOptions.filter(
    (option) => option.organizingRegistration,
  ),
  participantOptions: registrationOptions.filter(
    (option) => !option.organizingRegistration,
  ),
});

export const eventReviewActionDisabled = ({
  canReview,
  controlsInteractive,
  mutationPending,
  status,
}: {
  canReview: boolean;
  controlsInteractive: boolean;
  mutationPending: boolean;
  status: EventReviewStatus;
}): boolean =>
  !controlsInteractive ||
  !canReview ||
  status !== 'PENDING_REVIEW' ||
  mutationPending;

export const eventSubmitForReviewActionDisabled = ({
  canEdit,
  controlsInteractive,
  mutationPending,
  status,
}: {
  canEdit: boolean;
  controlsInteractive: boolean;
  mutationPending: boolean;
  status: EventReviewStatus;
}): boolean =>
  !controlsInteractive || !canEdit || status !== 'DRAFT' || mutationPending;

export const eventCanEdit = ({
  canEditAll,
  isCreator,
  status,
}: {
  canEditAll: boolean;
  isCreator: boolean;
  status: EventReviewStatus;
}): boolean => status === 'DRAFT' && (canEditAll || isCreator);

export const eventCanSeeStatus = ({
  canEdit,
  canReview,
  canSeeDrafts,
  isCreator,
}: {
  canEdit: boolean;
  canReview: boolean;
  canSeeDrafts: boolean;
  isCreator: boolean;
}): boolean => canReview || canEdit || canSeeDrafts || isCreator;

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

export const eventRegistrationOptionTitle = (
  event: {
    registrationOptions: readonly { id: string; title: string }[];
  },
  registrationOptionId: string,
): string =>
  event.registrationOptions.find((option) => option.id === registrationOptionId)
    ?.title ?? 'Broken registration option configuration';

export const eventAddonsForRegistrationOption = <
  TAddOn extends {
    allowPurchaseDuringRegistration: boolean;
    registrationOptions: readonly {
      includedQuantity: number;
      registrationOptionId: string;
    }[];
  },
>(
  event: {
    addOns: readonly TAddOn[];
  },
  registrationOptionId: string,
) =>
  event.addOns.filter((addOn) => {
    const mapping = addOn.registrationOptions.find(
      (option) => option.registrationOptionId === registrationOptionId,
    );
    return (
      !!mapping &&
      (addOn.allowPurchaseDuringRegistration || mapping.includedQuantity > 0)
    );
  });

@Injectable({ providedIn: 'root' })
export class EventDetailsOperations {
  private readonly rpc = AppRpc.injectClient();

  canOrganize(eventId: string) {
    return this.rpc.events.canOrganize.queryOptions({ eventId });
  }

  eventListFilter() {
    return this.rpc.queryFilter(['events', 'eventList']);
  }

  eventQueryKey(id: string) {
    return this.rpc.events.findOne.queryKey({ id });
  }

  findEvent(id: string) {
    return this.rpc.events.findOne.queryOptions({ id });
  }

  myCards() {
    return this.rpc.discounts.getMyCards.queryOptions();
  }

  pendingReviewsFilter() {
    return this.rpc.queryFilter(['events', 'getPendingReviews']);
  }

  registrationStatus(eventId: string) {
    return this.rpc.events.getRegistrationStatus.queryOptions({ eventId });
  }

  reviewEvent() {
    return this.rpc.events.reviewEvent.mutationOptions();
  }

  self() {
    return this.rpc.users.maybeSelf.queryOptions();
  }

  submitForReview() {
    return this.rpc.events.submitForReview.mutationOptions();
  }

  updateListing() {
    return this.rpc.events.updateListing.mutationOptions();
  }
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.aria-busy]': '!controlsInteractive() || null',
  },
  imports: [
    CurrencyPipe,
    TenantDatePipe,
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
  styles: `
    header {
      view-transition-name: header;
      //h1 {
      //  view-transition-name: header-title;
      //}
      //app-shape {
      //  view-transition-name: header-shape;
      //}
      //app-icon {
      //  view-transition-name: header-icon;
      //}
    }
    .description {
      view-transition-name: event-description;
    }
  `,
  templateUrl: './event-details.component.html',
})
export class EventDetailsComponent {
  public eventId = input.required<string>();
  private readonly operations = inject(EventDetailsOperations);
  protected readonly eventQuery = injectQuery(() =>
    this.operations.findEvent(this.eventId()),
  );
  protected readonly selfQery = injectQuery(() => this.operations.self());
  private readonly isEventCreator = computed(() => {
    const event = this.eventQuery.data();
    const self = this.selfQery.data();
    return !!event && !!self && event.creatorId === self.id;
  });
  private permissions = inject(PermissionsService);
  protected readonly canEdit = computed(() => {
    const event = this.eventQuery.data();
    if (!event) {
      return false;
    }
    return eventCanEdit({
      canEditAll: this.permissions.hasPermission('events:editAll')(),
      isCreator: this.isEventCreator(),
      status: event.status,
    });
  });
  protected readonly canOrganizeQuery = injectQuery(() =>
    this.operations.canOrganize(this.eventId()),
  );
  protected readonly canOrganize = computed(() => {
    return this.canOrganizeQuery.isSuccess()
      ? this.canOrganizeQuery.data()
      : false;
  });
  protected readonly canReview =
    this.permissions.hasPermission('events:review');
  protected readonly canSeeStatus = computed(() => {
    return eventCanSeeStatus({
      canEdit: this.canEdit(),
      canReview: this.canReview(),
      canSeeDrafts: this.permissions.hasPermission('events:seeDrafts')(),
      isCreator: this.isEventCreator(),
    });
  });
  protected readonly myCardsQuery = injectQuery(() =>
    this.operations.myCards(),
  );
  private readonly config = inject(ConfigService);
  protected readonly cardExpiresBeforeEvent = computed(() => {
    const isEsnCardEnabled =
      this.config.tenant.discountProviders?.esnCard?.status === 'enabled';
    if (!isEsnCardEnabled) return false;
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
  protected readonly controlsInteractive = signal(false);
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
  protected readonly eventReviewActionDisabled = eventReviewActionDisabled;
  protected readonly eventSubmitForReviewActionDisabled =
    eventSubmitForReviewActionDisabled;
  protected readonly faArrowLeft = faArrowLeft;
  protected readonly faEllipsisVertical = faEllipsisVertical;
  protected readonly outgoingRegistrationTransferCopy =
    outgoingRegistrationTransferCopy;
  protected readonly registrationOptionGroups = computed(() =>
    eventRegistrationOptionGroups(
      this.eventQuery.data()?.registrationOptions ?? [],
    ),
  );
  protected readonly registrationOptionsState = computed(() => {
    const event = this.eventQuery.data();
    return event ? registrationOptionsState(event) : 'none';
  });
  protected readonly registrationOptionTitle = eventRegistrationOptionTitle;
  protected readonly registrationStatusQuery = injectQuery(() =>
    this.operations.registrationStatus(this.eventId()),
  );
  protected readonly reviewMutation = injectMutation(() =>
    this.operations.reviewEvent(),
  );
  protected readonly submitForReviewMutation = injectMutation(() =>
    this.operations.submitForReview(),
  );
  protected readonly updateListingMutation = injectMutation(() =>
    this.operations.updateListing(),
  );
  private dialog = inject(MatDialog);
  private notifications = inject(NotificationService);
  private queryClient = inject(QueryClient);

  constructor() {
    afterNextRender(() => this.controlsInteractive.set(true));

    effect(() => {
      const event = this.eventQuery.data();
      if (event) {
        this.config.updateTitle(event.title);
        this.config.updateDescription(convert(event.description));
      }
    });
  }

  async updateVisibility() {
    if (!this.controlsInteractive() || !this.eventQuery.isSuccess()) return;

    const event = this.eventQuery.data();

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

  protected async reviewEvent(approved: boolean): Promise<void> {
    const event = this.eventQuery.data();
    if (
      !event ||
      eventReviewActionDisabled({
        canReview: this.canReview(),
        controlsInteractive: this.controlsInteractive(),
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
        controlsInteractive: this.controlsInteractive(),
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
      queryKey: this.operations.eventQueryKey(this.eventId()),
    });
    await this.queryClient.invalidateQueries(this.operations.eventListFilter());
    await this.queryClient.invalidateQueries(
      this.operations.pendingReviewsFilter(),
    );
  }
}
