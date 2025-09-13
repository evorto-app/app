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
import { NotificationService } from '../../core/notification.service';
import { PermissionsService } from '../../core/permissions.service';
import { injectTRPC } from '../../core/trpc-client';
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
  standalone: true,
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
  private trpc = injectTRPC();
  protected readonly eventQuery = injectQuery(() =>
    this.trpc.events.findOne.queryOptions({ id: this.eventId() }),
  );
  protected readonly selfQery = injectQuery(() =>
    this.trpc.users.maybeSelf.queryOptions(),
  );
  private permissions = inject(PermissionsService);
  protected readonly canEdit = computed(() => {
    const editAllPermission =
      this.permissions.hasPermission('events:editAll')();
    if (editAllPermission) {
      return true;
    }
    const event = this.eventQuery.data();
    const self = this.selfQery.data();
    if (!self || !event) {
      return false;
    }
    if (event.creatorId === self.id) {
      return event?.status === 'DRAFT' || event?.status === 'REJECTED';
    }
    return false;
  });
  protected readonly canOrganize = computed(() => {
    const organizeAllPermission =
      this.permissions.hasPermission('events:organizeAll')();
    if (organizeAllPermission) {
      return true;
    }
    return false; // TODO: Implement logic to check if the user can organize this event
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
    this.trpc.discounts.getMyCards.queryOptions(),
  );
  protected readonly cardExpiresBeforeEvent = computed(() => {
    const event = this.eventQuery.data();
    const cards = this.myCardsQuery.data();
    if (!event || !cards) return false;
    const verified = cards.filter((c) => c.status === 'verified');
    if (verified.length === 0) return false;
    const latestValidTo = verified
      .map((c) => c.validTo)
      .filter((d): d is Date => !!d)
      .sort((a, b) => b.getTime() - a.getTime())[0];
    if (!latestValidTo) return false;
    return latestValidTo <= event.start;
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
    this.trpc.events.getRegistrationStatus.queryOptions({
      eventId: this.eventId(),
    }),
  );
  private queryClient = inject(QueryClient);
  protected readonly updateListingMutation = injectMutation(() =>
    this.trpc.events.updateListing.mutationOptions({
      onSuccess: async () => {
        await this.queryClient.invalidateQueries({
          queryKey: this.trpc.events.findOne.queryKey({ id: this.eventId() }),
        });
        await this.queryClient.invalidateQueries({
          queryKey: this.trpc.events.eventList.pathKey(),
        });
      },
    }),
  );
  private readonly config = inject(ConfigService);
  private dialog = inject(MatDialog);

  private notifications = inject(NotificationService);
  private readonly reviewMutation = injectMutation(() =>
    this.trpc.events.reviewEvent.mutationOptions({
      onSuccess: async () => {
        await this.queryClient.invalidateQueries({
          queryKey: this.trpc.events.findOne.queryKey({ id: this.eventId() }),
        });
        await this.queryClient.invalidateQueries({
          queryKey: this.trpc.events.eventList.pathKey(),
        });
        await this.queryClient.invalidateQueries({
          queryKey: this.trpc.events.findMany.pathKey(),
        });
      },
    }),
  );
  private readonly submitForReviewMutation = injectMutation(() =>
    this.trpc.events.submitForReview.mutationOptions({
      onSuccess: async () => {
        await this.queryClient.invalidateQueries({
          queryKey: this.trpc.events.findOne.queryKey({ id: this.eventId() }),
        });
        await this.queryClient.invalidateQueries({
          queryKey: this.trpc.events.eventList.pathKey(),
        });
      },
    }),
  );

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
      this.updateListingMutation.mutate({
        eventId: this.eventId(),
        unlisted,
      });
    }
  }

  protected async reviewEvent(approved: boolean): Promise<void> {
    if (approved) {
      await this.reviewMutation.mutateAsync({
        approved,
        eventId: this.eventId(),
      });
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
        const event = this.eventQuery.data();
        if (event) {
          this.notifications.showEventReviewed(approved, event.title);
        }
      }
    }
  }

  protected async submitForReview(): Promise<void> {
    const dialogReference = this.dialog.open(SubmitEventDialogComponent);
    const confirmed = await firstValueFrom(dialogReference.afterClosed());

    if (confirmed) {
      await this.submitForReviewMutation.mutateAsync({
        eventId: this.eventId(),
      });
      const event = this.eventQuery.data();
      if (event) {
        this.notifications.showEventSubmitted(event.title);
      }
    }
  }
}
