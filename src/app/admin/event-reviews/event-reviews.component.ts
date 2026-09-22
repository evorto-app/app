import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { RouterLink } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import {
  faArrowLeft,
  faArrowUpRightFromSquare,
  faRotateRight,
} from '@fortawesome/duotone-regular-svg-icons';
import {
  injectMutation,
  injectQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import consola from 'consola/browser';
import { firstValueFrom, interval } from 'rxjs';

import { AppRpc } from '../../core/effect-rpc-angular-client';
import { getErrorMessage } from '../../core/error-message';
import { NotificationService } from '../../core/notification.service';
import { TenantDatePipe } from '../../core/tenant-date.pipe';
import {
  EventReviewDialogComponent,
  type EventReviewDialogData,
} from '../../events/event-review-dialog/event-review-dialog.component';
import { eventReviewActionErrorRequiresRefresh } from '../../events/event-rpc-error';

const logger = consola.withTag('app/admin/event-reviews');

export const eventReviewQueueActionDisabled = ({
  actionPending,
  mutationPending,
  recoveryRequired,
}: {
  actionPending: boolean;
  mutationPending: boolean;
  recoveryRequired: boolean;
}): boolean => actionPending || mutationPending || recoveryRequired;

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.aria-busy]': 'reviewActionPending() || null' },
  imports: [MatButtonModule, RouterLink, FontAwesomeModule, TenantDatePipe],
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
      <h1 class="title-large">Event reviews</h1>
      <div class="grow"></div>
      <button
        mat-icon-button
        (click)="refreshReviews()"
        [disabled]="reviewActionPending()"
        aria-label="Check pending reviews again"
      >
        <fa-duotone-icon [icon]="faRotateRight" />
      </button>
    </div>

    @if (reviewActionFeedback(); as feedback) {
      <div class="mb-4" role="status" data-testid="event-review-action-message">
        <p>{{ feedback.message }}</p>
        @if (reviewRecoveryRequired()) {
          <button
            mat-stroked-button
            (click)="refreshReviews()"
            [disabled]="reviewActionPending()"
          >
            Load latest reviews
          </button>
        }
        <a mat-button [routerLink]="['/events', feedback.eventId]"
          >Open event</a
        >
      </div>
    }
    @if (reviewRefreshFailed()) {
      <p class="mb-4" role="status">
        The latest event information could not be loaded. Load it again before
        making another change.
      </p>
    }

    @if (pendingReviewsQuery.isPending()) {
      <div class="flex items-center justify-center p-8">
        <span class="text-on-surface-variant">Loading…</span>
      </div>
    } @else if (pendingReviewsQuery.isError()) {
      <div class="flex flex-col items-center justify-center gap-2 p-8">
        <span class="text-on-surface-variant">
          Failed to load pending reviews.
        </span>
        <button
          mat-stroked-button
          (click)="refreshReviews()"
          [disabled]="reviewActionPending()"
        >
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
                    [disabled]="
                      eventReviewQueueActionDisabled({
                        actionPending: reviewActionPending(),
                        mutationPending: reviewEventMutation.isPending(),
                        recoveryRequired: reviewRecoveryRequired(),
                      })
                    "
                  >
                    Return to draft
                  </button>
                  <button
                    mat-flat-button
                    (click)="reviewEvent(event.id, event.title, true)"
                    [disabled]="
                      eventReviewQueueActionDisabled({
                        actionPending: reviewActionPending(),
                        mutationPending: reviewEventMutation.isPending(),
                        recoveryRequired: reviewRecoveryRequired(),
                      })
                    "
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
                <fa-duotone-icon [icon]="faArrowUpRightFromSquare" />
                Open event
              </a>
            </div>
          }
        </div>
      }
    }
  `,
})
export class EventReviewsComponent {
  protected readonly eventReviewQueueActionDisabled =
    eventReviewQueueActionDisabled;
  protected readonly faArrowLeft = faArrowLeft;
  protected readonly faArrowUpRightFromSquare = faArrowUpRightFromSquare;
  protected readonly faRotateRight = faRotateRight;
  private readonly rpc = AppRpc.injectClient();
  protected readonly pendingReviewsQuery = injectQuery(() =>
    this.rpc.events.getPendingReviews.queryOptions(),
  );
  protected readonly reviewActionFeedback = signal<null | {
    eventId: string;
    message: string;
    messageAfterRefresh?: string | undefined;
  }>(null);
  protected readonly reviewActionPending = signal(false);
  protected readonly reviewRecoveryRequired = signal(false);
  protected readonly reviewRefreshFailed = signal(false);
  protected readonly reviewEventMutation = injectMutation(() =>
    this.rpc.events.reviewEvent.mutationOptions(),
  );
  private readonly dialog = inject(MatDialog);
  private readonly notifications = inject(NotificationService);
  private readonly queryClient = inject(QueryClient);
  private readonly retainedReviewComments = new Map<string, string>();

  constructor() {
    // Auto-refresh pending reviews every 30 seconds
    interval(30_000)
      .pipe(takeUntilDestroyed())
      .subscribe(() => {
        if (!this.reviewActionPending()) {
          void this.pendingReviewsQuery.refetch();
        }
      });
  }

  protected async refreshReviews(): Promise<void> {
    if (this.reviewActionPending()) return;

    this.reviewActionPending.set(true);
    try {
      await this.refreshReviewState();
      this.reviewRefreshFailed.set(false);
      this.reviewRecoveryRequired.set(false);
      this.reviewActionFeedback.update((feedback) =>
        feedback?.messageAfterRefresh
          ? { ...feedback, message: feedback.messageAfterRefresh }
          : feedback,
      );
    } catch (error) {
      logger.error('Loading the latest event reviews failed', error);
      this.reviewRecoveryRequired.set(true);
      this.reviewRefreshFailed.set(true);
      this.notifications.showError(
        'The latest event information could not be loaded. Load it again before making another change.',
      );
    } finally {
      this.reviewActionPending.set(false);
    }
  }

  protected async reviewEvent(
    eventId: string,
    eventTitle: string,
    approved: boolean,
  ): Promise<void> {
    if (
      eventReviewQueueActionDisabled({
        actionPending: this.reviewActionPending(),
        mutationPending: this.reviewEventMutation.isPending(),
        recoveryRequired: this.reviewRecoveryRequired(),
      })
    ) {
      return;
    }

    this.reviewActionPending.set(true);
    let actionStep: 'confirmation' | 'mutation' | 'refresh' = 'confirmation';
    try {
      if (approved) {
        this.reviewActionFeedback.set(null);
        this.reviewRefreshFailed.set(false);
        actionStep = 'mutation';
        await this.reviewEventMutation.mutateAsync({ approved, eventId });
      } else {
        const dialogReference = this.dialog.open<
          EventReviewDialogComponent,
          EventReviewDialogData,
          string
        >(EventReviewDialogComponent, {
          data: {
            initialComment: this.retainedReviewComments.get(eventId) ?? '',
          },
        });
        const comment = await firstValueFrom(dialogReference.afterClosed());
        if (!comment) return;
        this.retainedReviewComments.set(eventId, comment);
        this.reviewActionFeedback.set(null);
        this.reviewRefreshFailed.set(false);
        actionStep = 'mutation';
        await this.reviewEventMutation.mutateAsync({
          approved,
          comment,
          eventId,
        });
      }
      actionStep = 'refresh';
      await this.refreshReviewState();
      this.retainedReviewComments.delete(eventId);
      this.notifications.showEventReviewed(approved, eventTitle);
    } catch (error) {
      logger.error('Event review queue action failed', error);
      if (actionStep === 'refresh') {
        this.reviewRecoveryRequired.set(true);
        this.reviewRefreshFailed.set(true);
        this.showReviewActionError(
          eventId,
          approved
            ? 'The event was approved. Load the latest reviews before making another change.'
            : 'The event was returned to draft. Load the latest reviews before making another change.',
          approved
            ? 'The event was approved. The review list has been refreshed.'
            : 'The event was returned to draft. The review list has been refreshed.',
        );
      } else if (actionStep === 'confirmation') {
        this.showReviewActionError(
          eventId,
          'The action could not be confirmed. Try opening it again.',
        );
      } else {
        await this.handleReviewActionError(error, eventId);
      }
    } finally {
      this.reviewActionPending.set(false);
    }
  }

  private async handleReviewActionError(
    error: unknown,
    eventId: string,
  ): Promise<void> {
    this.reviewRecoveryRequired.set(true);
    const message = getErrorMessage(
      error,
      'The outcome could not be confirmed. Load the latest reviews and open the event to check its status before making another change.',
      ['EventConflictError', 'EventNotFoundError', 'RpcBadRequestError'],
    );
    if (eventReviewActionErrorRequiresRefresh(error)) {
      try {
        await this.refreshReviewState();
      } catch (refreshError) {
        logger.error(
          'Event review conflict and follow-up read failed',
          new AggregateError(
            [error, refreshError],
            'Review conflict and follow-up read failed',
            { cause: refreshError },
          ),
        );
        this.reviewRefreshFailed.set(true);
      }
    }
    const refreshedMessage = getErrorMessage(
      error,
      'The earlier review outcome is still unconfirmed. Open the event to check its status before making another change.',
      ['EventConflictError', 'EventNotFoundError', 'RpcBadRequestError'],
    );
    this.showReviewActionError(
      eventId,
      message,
      'The review list has been refreshed. ' + refreshedMessage,
    );
  }

  private async refreshReviewState(): Promise<void> {
    const filters = [
      this.rpc.queryFilter(['events', 'getPendingReviews']),
      this.rpc.queryFilter(['events', 'eventList']),
      this.rpc.queryFilter(['events', 'findOne']),
    ];
    // Own each matching query separately: a failed read must not release
    // the action lock while a sibling under the same filter is still running.
    const reads = filters.flatMap((filter) =>
      this.queryClient
        .getQueryCache()
        .findAll(filter)
        .map((query) => async () => {
          await this.queryClient.invalidateQueries(
            { ...filter, exact: true, queryKey: query.queryKey },
            { throwOnError: true },
          );
          // A paused offline refetch resolves without reading; it cannot unlock recovery.
          if (query.isActive() && query.state.fetchStatus !== 'idle') {
            throw new Error('An event review follow-up read did not complete.');
          }
        }),
    );
    const results = await Promise.allSettled(reads.map(async (read) => read()));
    const failures: unknown[] = results
      .filter((result) => result.status === 'rejected')
      .map((result) => result.reason);
    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        'Event review follow-up reads failed',
        {
          cause: failures[0],
        },
      );
    }
  }

  private showReviewActionError(
    eventId: string,
    message: string,
    messageAfterRefresh?: string,
  ): void {
    this.reviewActionFeedback.set({ eventId, message, messageAfterRefresh });
    this.notifications.showError(message);
  }
}
