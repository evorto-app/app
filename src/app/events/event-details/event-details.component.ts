import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
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
import { NotificationService } from '../../core/notification.service';
import { PermissionsService } from '../../core/permissions.service';
import { EventStatusComponent } from '../../shared/components/event-status/event-status.component';
import { IfAnyPermissionDirective } from '../../shared/directives/if-any-permission.directive';
import { EventActiveRegistrationComponent } from '../event-active-registration/event-active-registration.component';
import { EventRegistrationOptionComponent } from '../event-registration-option/event-registration-option.component';
import { EventReviewDialogComponent } from '../event-review-dialog/event-review-dialog.component';
import { SubmitEventDialogComponent } from '../submit-event-dialog/submit-event-dialog.component';
import { UpdateVisibilityDialogComponent } from '../update-visibility-dialog/update-visibility-dialog.component';

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
    return this.canOrganizeQuery.data() ?? false;
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
    const event = this.eventQuery.data();
    const cards = this.myCardsQuery.data();
    if (!event || !cards) return false;
    const verified = cards.filter((c) => c.status === 'verified');
    if (verified.length === 0) return false;
    const latestValidTo = verified
      .map((card) => (card.validTo ? new Date(card.validTo) : undefined))
      .filter((date): date is Date => !!date && !Number.isNaN(date.getTime()))
      .toSorted((a, b) => b.getTime() - a.getTime())[0];
    if (!latestValidTo) return false;
    return latestValidTo <= new Date(event.start);
  });

  protected readonly eventIconColor = computed(() => {
    const event = this.eventQuery.data();
    if (!event) {
      return;
    }
    return event.icon.iconColor;
  });
  protected readonly faArrowLeft = faArrowLeft;
  protected readonly faEllipsisVertical = faEllipsisVertical;
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
    const unlisted = await firstValueFrom(
      this.dialog
        .open(UpdateVisibilityDialogComponent, {
          data: { event: this.eventQuery.data() },
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

  protected async reviewEvent(approved: boolean): Promise<void> {
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
    const message =
      error instanceof Error
        ? error.message
        : 'Failed to update event review status';
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
