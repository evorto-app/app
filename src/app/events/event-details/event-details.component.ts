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
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import {
  faArrowLeft,
  faEllipsisVertical,
} from '@fortawesome/duotone-regular-svg-icons';
import {
  injectMutation,
  injectQuery,
} from '@tanstack/angular-query-experimental';
import { convert } from 'html-to-text';
import { firstValueFrom } from 'rxjs';

import { ConfigService } from '../../core/config.service';
import { NotificationService } from '../../core/notification.service';
import { PermissionsService } from '../../core/permissions.service';
import { QueriesService } from '../../core/queries.service';
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
  ],
  standalone: true,
  templateUrl: './event-details.component.html',
})
export class EventDetailsComponent {
  public eventId = input.required<string>();
  private queries = inject(QueriesService);
  protected readonly eventQuery = injectQuery(this.queries.event(this.eventId));
  protected readonly selfQery = injectQuery(this.queries.maybeSelf());
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
  protected readonly canReview =
    this.permissions.hasPermission('events:review');
  protected readonly canSeeStatus = computed(() => {
    const canReview = this.permissions.hasPermission('events:review')();
    const canEdit = this.canEdit();
    const canSeeDrafts = this.permissions.hasPermission('events:seeDrafts')();
    return canReview || canEdit || canSeeDrafts;
  });
  protected readonly faArrowLeft = faArrowLeft;
  protected readonly faEllipsisVertical = faEllipsisVertical;
  protected readonly registrationStatusQuery = injectQuery(
    this.queries.eventRegistrationStatus(this.eventId),
  );
  protected readonly updateVisibilityMutation = injectMutation(
    this.queries.updateEventVisibility(),
  );
  private readonly config = inject(ConfigService);
  private dialog = inject(MatDialog);

  private notifications = inject(NotificationService);
  private readonly reviewMutation = injectMutation(this.queries.reviewEvent());
  private readonly submitForReviewMutation = injectMutation(
    this.queries.submitEventForReview(),
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
    const visibility = await firstValueFrom(
      this.dialog
        .open(UpdateVisibilityDialogComponent, {
          data: { event: this.eventQuery.data() },
        })
        .afterClosed(),
    );
    if (visibility) {
      this.updateVisibilityMutation.mutate({
        eventId: this.eventId(),
        visibility,
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
