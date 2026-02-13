import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import {
  faArrowLeft,
  faArrowUpRightFromSquare,
} from '@fortawesome/duotone-regular-svg-icons';
import {
  injectMutation,
  injectQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { firstValueFrom, interval } from 'rxjs';

import { AppRpc } from '../../core/effect-rpc-angular-client';
import { NotificationService } from '../../core/notification.service';
import { EventReviewDialogComponent } from '../../events/event-review-dialog/event-review-dialog.component';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatIconModule,
    RouterLink,
    FontAwesomeModule,
    DatePipe,
  ],
  selector: 'app-event-reviews',
  standalone: true,
  template: `
    <div class="mb-4 flex flex-row items-center gap-2">
      <a
        routerLink="/admin"
        mat-icon-button
        class="lg:hidden! block"
        aria-label="Back to admin overview"
      >
        <fa-duotone-icon [icon]="faArrowLeft" />
      </a>
      <h1 class="title-large">Event Reviews</h1>
      <div class="grow"></div>
      <button
        mat-icon-button
        (click)="pendingReviewsQuery.refetch()"
        aria-label="Refresh pending reviews"
      >
        <mat-icon>refresh</mat-icon>
      </button>
    </div>

    @if (pendingReviewsQuery.isPending()) {
      <div class="flex items-center justify-center p-8">
        <span class="text-on-surface-variant">Loading…</span>
      </div>
    } @else if (pendingReviewsQuery.isError()) {
      <div class="flex flex-col items-center justify-center gap-2 p-8">
        <span class="text-on-surface-variant">
          Failed to load pending reviews.
        </span>
        <button mat-stroked-button (click)="pendingReviewsQuery.refetch()">
          Retry
        </button>
      </div>
    } @else if (pendingReviewsQuery.isSuccess()) {
      @if (pendingReviewsQuery.data().length === 0) {
        <div class="flex items-center justify-center p-8">
          <span class="text-on-surface-variant">No pending reviews</span>
        </div>
      } @else {
        <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
          @for (event of pendingReviewsQuery.data(); track event.id) {
            <div
              class="bg-surface text-on-surface flex flex-col gap-2 rounded-2xl p-4"
            >
              <div class="flex items-center justify-between">
                <h2 class="title-medium">{{ event.title }}</h2>
                <div class="flex gap-2">
                  <button
                    mat-stroked-button
                    (click)="reviewEvent(event.id, event.title, false)"
                    [disabled]="reviewEventMutation.isPending()"
                  >
                    Reject
                  </button>
                  <button
                    mat-flat-button
                    (click)="reviewEvent(event.id, event.title, true)"
                    [disabled]="reviewEventMutation.isPending()"
                  >
                    Approve
                  </button>
                </div>
              </div>
              <div class="text-on-surface-variant">
                <p>Start: {{ event.start | date: 'medium' }}</p>
                <!--                <p>End: {{ event.end | date: 'medium' }}</p>-->
              </div>
              <!--              <div [innerHTML]="event.description"></div>-->
              <div class="mt-2">
                <!--                <h3 class="title-small mb-2">Registration Options:</h3>-->
                <!--                @for (option of event.registrationOptions; track option.id) {-->
                <!--                  <div class="text-on-surface-variant ml-4">-->
                <!--                    <p>{{ option.title }} - {{ option.spots }} spots</p>-->
                <!--                    <p>Price: {{ option.price | currency }}</p>-->
                <!--                  </div>-->
                <!--                }-->
              </div>
              <a mat-button routerLink="/events/{{ event.id }}">
                <fa-duotone-icon [icon]="faArrowUpRightFromSquare"
                 />
                Open Event
              </a>
            </div>
          }
        </div>
      }
    }
  `,
})
export class EventReviewsComponent {
  protected readonly faArrowLeft = faArrowLeft;
  protected readonly faArrowUpRightFromSquare = faArrowUpRightFromSquare;
  protected readonly pendingReviewsQuery = injectQuery(() =>
    AppRpc.injectClient().events.getPendingReviews.queryOptions(),
  );
  private readonly rpc = AppRpc.injectClient();
  protected readonly reviewEventMutation = injectMutation(() =>
    this.rpc.events.reviewEvent.mutationOptions(),
  );
  private readonly dialog = inject(MatDialog);
  private readonly notifications = inject(NotificationService);
  private readonly queryClient = inject(QueryClient);

  constructor() {
    // Auto-refresh pending reviews every 30 seconds
    interval(30_000)
      .pipe(takeUntilDestroyed())
      .subscribe(() => {
        this.pendingReviewsQuery.refetch();
      });
  }

  protected async reviewEvent(
    eventId: string,
    eventTitle: string,
    approved: boolean,
  ): Promise<void> {
    try {
      if (approved) {
        await this.reviewEventMutation.mutateAsync({ approved, eventId });
      } else {
        const dialogReference = this.dialog.open(EventReviewDialogComponent);
        const comment = await firstValueFrom(dialogReference.afterClosed());
        if (!comment) {
          return;
        }
        await this.reviewEventMutation.mutateAsync({
          approved,
          comment,
          eventId,
        });
      }
      await this.refreshReviewState();
      this.notifications.showEventReviewed(approved, eventTitle);
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
      normalizedMessage.includes('no longer pending review')
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
    await this.queryClient.invalidateQueries(
      this.rpc.queryFilter(['events', 'getPendingReviews']),
    );
    await this.queryClient.invalidateQueries(
      this.rpc.queryFilter(['events', 'eventList']),
    );
    await this.queryClient.invalidateQueries(
      this.rpc.queryFilter(['events', 'findOne']),
    );
  }
}
