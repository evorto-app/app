import '@angular/compiler';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { provideRouter } from '@angular/router';
import { createRpcQueryFilter } from '@heddendorp/effect-angular-query';
import { EventConflictError } from '@shared/rpc-contracts/app-rpcs/events.errors';
import {
  onlineManager,
  provideTanStackQuery,
  QueryClient,
  QueryObserver,
} from '@tanstack/angular-query-experimental';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  APP_RPC_CLIENT,
  type AppRpc,
} from '../../core/effect-rpc-angular-client';
import { NotificationService } from '../../core/notification.service';
import { TENANT_DATE_PIPE_TIMEZONE } from '../../core/tenant-date.pipe';
import {
  eventReviewQueueActionDisabled,
  EventReviewsComponent,
} from './event-reviews.component';

describe('eventReviewQueueActionDisabled', () => {
  it('blocks review queue actions while a review mutation is pending', () => {
    expect(
      eventReviewQueueActionDisabled({
        actionPending: false,
        mutationPending: false,
        recoveryRequired: false,
      }),
    ).toBe(false);
    expect(
      eventReviewQueueActionDisabled({
        actionPending: false,
        mutationPending: true,
        recoveryRequired: false,
      }),
    ).toBe(true);
    expect(
      eventReviewQueueActionDisabled({
        actionPending: true,
        mutationPending: false,
        recoveryRequired: false,
      }),
    ).toBe(true);
  });
});

describe('EventReviewsComponent review recovery', () => {
  type Rpc = ReturnType<typeof AppRpc.injectClient>;
  type ReviewList = Awaited<
    ReturnType<Rpc['events']['getPendingReviews']['call']>
  >;
  type EventList = Awaited<ReturnType<Rpc['events']['eventList']['call']>>;
  type ReviewMutation = NonNullable<
    ReturnType<Rpc['events']['reviewEvent']['mutationOptions']>['mutationFn']
  >;
  const review = vi.fn<ReviewMutation>();
  const loadQueue = vi.fn<() => Promise<ReviewList>>();
  const reviewedNotice = vi.fn<NotificationService['showEventReviewed']>();
  const errorNotice = vi.fn<NotificationService['showError']>();
  const comment = 'Please confirm the accessible entrance.';
  const uncertainMessage =
    'The outcome could not be confirmed. Load the latest reviews and open the event to check its status before making another change.';
  const readFailureMessage =
    'The latest event information could not be loaded. Load it again before making another change.';
  const records: ReviewList = [
    {
      id: 'event-1',
      start: '2030-01-02T10:00:00.000Z',
      title: 'First workshop',
    },
    {
      id: 'event-2',
      start: '2030-01-03T10:00:00.000Z',
      title: 'Second workshop',
    },
  ];
  let fixture: ComponentFixture<EventReviewsComponent> | undefined;
  let queryClient: QueryClient;
  let dialog: MatDialog;

  const rootElement = () => {
    const element: unknown = fixture?.nativeElement;
    if (!(element instanceof HTMLElement))
      throw new Error('Expected the actual event-review queue.');
    return element;
  };
  const detectChanges = () => {
    if (!fixture) throw new Error('Expected an event-review queue fixture.');
    fixture.detectChanges();
  };
  const buttonNamed = (root: ParentNode, text: string) => {
    const button = [...root.querySelectorAll<HTMLButtonElement>('button')].find(
      (candidate) =>
        candidate.textContent?.replaceAll(/\s+/g, ' ').trim() === text,
    );
    if (!button) throw new Error('Expected the ' + text + ' button.');
    return button;
  };
  const reviewButton = (approved: boolean, title = 'First workshop') => {
    const heading = [...rootElement().querySelectorAll('h2')].find(
      (candidate) => candidate.textContent?.trim() === title,
    );
    const row = heading?.parentElement;
    if (!row) throw new Error('Expected the review controls for ' + title);
    return buttonNamed(row, approved ? 'Approve' : 'Return to draft');
  };
  const dialogElement = () => {
    const element = document.querySelector<HTMLElement>('mat-dialog-container');
    if (!element)
      throw new Error('Expected the actual Material review dialog.');
    return element;
  };
  const commentField = (root: ParentNode) => {
    const field = root.querySelector<HTMLTextAreaElement>('textarea');
    if (!field) throw new Error('Expected the feedback field.');
    return field;
  };
  const expectFeedback = async (message: string) => {
    await vi.waitFor(() => {
      detectChanges();
      expect(
        rootElement().querySelector(
          '[data-testid="event-review-action-message"]',
        )?.textContent,
      ).toContain(message);
      expect(errorNotice).toHaveBeenCalledWith(message);
      expect(rootElement().getAttribute('aria-busy')).toBeNull();
    });
  };
  const expectSingleMutation = (approved: boolean) => {
    expect(review).toHaveBeenCalledExactlyOnceWith(
      approved
        ? { approved, eventId: 'event-1' }
        : { approved, comment, eventId: 'event-1' },
      expect.objectContaining({ client: queryClient }),
    );
  };
  const expectWritesBlocked = async () => {
    const writesBefore = review.mock.calls.length;
    for (const title of ['First workshop', 'Second workshop']) {
      for (const approved of [true, false]) {
        const button = reviewButton(approved, title);
        expect(button.disabled).toBe(true);
        // Synthetic dispatch reaches the handler even on a disabled control.
        button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      }
    }
    await Promise.resolve();
    await vi.waitFor(() => {
      detectChanges();
      expect(rootElement().getAttribute('aria-busy')).toBeNull();
      expect(review).toHaveBeenCalledTimes(writesBefore);
      expect(dialog.openDialogs).toHaveLength(0);
    });
  };
  const openReturnDialog = async (title = 'First workshop') => {
    reviewButton(false, title).click();
    await vi.waitFor(() => {
      detectChanges();
      expect(dialogElement().textContent).toContain('Return event to draft');
    });
    return dialogElement();
  };
  const cancelDialog = async () => {
    buttonNamed(dialogElement(), 'Cancel').click();
    await vi.waitFor(() => {
      detectChanges();
      expect(dialog.openDialogs).toHaveLength(0);
      expect(rootElement().getAttribute('aria-busy')).toBeNull();
    });
  };
  const confirmAction = async (approved: boolean) => {
    if (approved) {
      reviewButton(true).click();
      return;
    }
    const currentDialog = await openReturnDialog();
    const field = commentField(currentDialog);
    field.value = comment;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    detectChanges();
    const form = currentDialog.querySelector('form');
    if (!form) throw new Error('Expected the actual feedback form.');
    expect(buttonNamed(currentDialog, 'Return to draft').disabled).toBe(false);
    form.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
  };
  const render = async () => {
    fixture = TestBed.createComponent(EventReviewsComponent);
    await vi.waitFor(() => {
      detectChanges();
      expect(reviewButton(true).disabled).toBe(false);
      expect(reviewButton(false).disabled).toBe(false);
    });
  };

  beforeEach(async () => {
    fixture = undefined;
    review.mockReset().mockResolvedValue(undefined);
    loadQueue.mockReset().mockResolvedValue(records);
    reviewedNotice.mockReset();
    errorNotice.mockReset();
    queryClient = new QueryClient({
      defaultOptions: {
        mutations: { gcTime: 0, retry: false },
        queries: { gcTime: 0, retry: false, staleTime: Infinity },
      },
    });
    const pendingOptions: ReturnType<
      Rpc['events']['getPendingReviews']['queryOptions']
    > = {
      queryFn: loadQueue,
      queryKey: [['events', 'getPendingReviews'], { type: 'query' }],
    };
    const reviewOptions: ReturnType<
      Rpc['events']['reviewEvent']['mutationOptions']
    > = { mutationFn: review };
    await TestBed.configureTestingModule({
      imports: [EventReviewsComponent, MatDialogModule],
      providers: [
        provideRouter([]),
        provideTanStackQuery(queryClient),
        { provide: TENANT_DATE_PIPE_TIMEZONE, useValue: 'Europe/Berlin' },
        {
          provide: APP_RPC_CLIENT,
          useValue: {
            events: {
              getPendingReviews: { queryOptions: () => pendingOptions },
              reviewEvent: { mutationOptions: () => reviewOptions },
            },
            queryFilter: createRpcQueryFilter,
          },
        },
        {
          provide: NotificationService,
          useValue: {
            showError: errorNotice,
            showEventReviewed: reviewedNotice,
          } satisfies Pick<
            NotificationService,
            'showError' | 'showEventReviewed'
          >,
        },
      ],
    }).compileComponents();
    dialog = TestBed.inject(MatDialog);
  });

  afterEach(() => {
    const failures: unknown[] = [];
    for (const cleanup of [
      () => dialog.closeAll(),
      () => fixture?.destroy(),
      () => queryClient.clear(),
      () => TestBed.resetTestingModule(),
    ]) {
      try {
        cleanup();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0)
      throw new AggregateError(failures, 'Event-review queue cleanup failed');
  });

  it('requires successful explicit recovery after a lost response and retains per-event comments', async () => {
    await render();
    let simulatedCommit = false;
    review.mockImplementationOnce(async () => {
      simulatedCommit = true;
      throw new Error('Private response transport failure after commit.');
    });
    await confirmAction(false);
    await expectFeedback(uncertainMessage);
    expect(simulatedCommit).toBe(true);
    expectSingleMutation(false);
    expect(reviewedNotice).not.toHaveBeenCalled();
    expect(rootElement().textContent).not.toContain('Private response');
    expect(loadQueue).toHaveBeenCalledTimes(1);
    expect(
      rootElement()
        .querySelector(':scope [data-testid="event-review-action-message"] a')
        ?.getAttribute('href'),
    ).toBe('/events/event-1');
    await expectWritesBlocked();

    // A background read does not satisfy the required explicit recovery.
    await queryClient.refetchQueries(
      createRpcQueryFilter(['events', 'getPendingReviews']),
      { throwOnError: true },
    );
    detectChanges();
    expect(loadQueue).toHaveBeenCalledTimes(2);
    await expectWritesBlocked();

    loadQueue.mockRejectedValueOnce(new Error('Manual recovery read failed.'));
    buttonNamed(rootElement(), 'Load latest reviews').click();
    await vi.waitFor(() => {
      detectChanges();
      expect(loadQueue).toHaveBeenCalledTimes(3);
      expect(rootElement().getAttribute('aria-busy')).toBeNull();
      expect(rootElement().textContent?.replaceAll(/\s+/g, ' ')).toContain(
        readFailureMessage,
      );
    });
    expectSingleMutation(false);

    let releaseQueue: ((value: ReviewList) => void) | undefined;
    // Angular's browser target does not expose Promise.withResolvers.
    // eslint-disable-next-line unicorn/prefer-promise-with-resolvers
    const recoveryRead = new Promise<ReviewList>((resolve) => {
      releaseQueue = resolve;
    });
    loadQueue.mockReturnValueOnce(recoveryRead);
    buttonNamed(rootElement(), 'Load latest reviews').click();
    try {
      await vi.waitFor(() => {
        detectChanges();
        expect(loadQueue).toHaveBeenCalledTimes(4);
        expect(rootElement().getAttribute('aria-busy')).toBe('true');
        expect(buttonNamed(rootElement(), 'Load latest reviews').disabled).toBe(
          true,
        );
      });
      expectSingleMutation(false);
    } finally {
      releaseQueue?.(records);
      await recoveryRead;
      await vi.waitFor(() => {
        detectChanges();
        expect(rootElement().getAttribute('aria-busy')).toBeNull();
      });
    }
    const feedback = rootElement().querySelector(
      '[data-testid="event-review-action-message"]',
    );
    expect(feedback?.textContent).toContain(
      'The review list has been refreshed. The earlier review outcome is still unconfirmed. Open the event to check its status before making another change.',
    );
    expect(feedback?.textContent).not.toContain('Load latest reviews');
    expect(rootElement().textContent).not.toContain(readFailureMessage);
    expect(reviewButton(true).disabled).toBe(false);
    expect(reviewButton(false).disabled).toBe(false);
    expectSingleMutation(false);

    const otherDialog = await openReturnDialog('Second workshop');
    expect(commentField(otherDialog).value).toBe('');
    await cancelDialog();
    const retainedDialog = await openReturnDialog();
    expect(commentField(retainedDialog).value).toBe(comment);
    const form = retainedDialog.querySelector('form');
    if (!form) throw new Error('Expected the retained review form');
    form.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    await vi.waitFor(() => {
      detectChanges();
      expect(review).toHaveBeenCalledTimes(2);
      expect(reviewedNotice).toHaveBeenCalledExactlyOnceWith(
        false,
        'First workshop',
      );
      expect(rootElement().getAttribute('aria-busy')).toBeNull();
    });
  });

  it('does not require recovery after a confirmation dialog is cancelled', async () => {
    await render();
    await openReturnDialog();
    await cancelDialog();
    expect(review).not.toHaveBeenCalled();
    expect(loadQueue).toHaveBeenCalledOnce();
    expect(reviewButton(true).disabled).toBe(false);
    expect(reviewButton(false).disabled).toBe(false);
    expect(
      rootElement().querySelector(
        '[data-testid="event-review-action-message"]',
      ),
    ).toBeNull();
    await confirmAction(true);
    await vi.waitFor(() => {
      detectChanges();
      expect(reviewedNotice).toHaveBeenCalledExactlyOnceWith(
        true,
        'First workshop',
      );
      expect(rootElement().getAttribute('aria-busy')).toBeNull();
    });
    expectSingleMutation(true);
  });

  it('does not unlock an uncertain write when an offline refresh only pauses', async () => {
    await render();
    review.mockRejectedValueOnce(new Error('Uncertain write response'));
    await confirmAction(true);
    await expectFeedback(uncertainMessage);
    try {
      onlineManager.setOnline(false);
      buttonNamed(rootElement(), 'Load latest reviews').click();
      await vi.waitFor(() => {
        detectChanges();
        expect(rootElement().getAttribute('aria-busy')).toBeNull();
        expect(rootElement().textContent?.replaceAll(/\s+/g, ' ')).toContain(
          readFailureMessage,
        );
      });
      expect(loadQueue).toHaveBeenCalledOnce();
      await expectWritesBlocked();
    } finally {
      onlineManager.setOnline(true);
      await vi.waitFor(() => {
        detectChanges();
        expect(queryClient.isFetching()).toBe(0);
      });
    }
    await expectWritesBlocked();
    buttonNamed(rootElement(), 'Load latest reviews').click();
    await vi.waitFor(() => {
      detectChanges();
      expect(rootElement().getAttribute('aria-busy')).toBeNull();
      expect(reviewButton(true).disabled).toBe(false);
    });
    expectSingleMutation(true);
    expect(
      rootElement().querySelector('[data-testid="event-review-action-message"]')
        ?.textContent,
    ).toContain('The earlier review outcome is still unconfirmed.');
  });

  it.each([true, false])(
    'keeps approved=%s confirmed when its follow-up queue read fails and a read-only retry succeeds',
    async (approved) => {
      await render();
      loadQueue.mockRejectedValueOnce(new Error('Private queue read failure.'));
      await confirmAction(approved);
      const message = approved
        ? 'The event was approved. Load the latest reviews before making another change.'
        : 'The event was returned to draft. Load the latest reviews before making another change.';
      await expectFeedback(message);
      expect(rootElement().textContent?.replaceAll(/\s+/g, ' ')).toContain(
        readFailureMessage,
      );
      expect(rootElement().textContent).not.toContain(uncertainMessage);
      expect(rootElement().textContent).not.toContain('Private queue');
      expectSingleMutation(approved);
      expect(reviewedNotice).not.toHaveBeenCalled();

      buttonNamed(rootElement(), 'Load latest reviews').click();
      await vi.waitFor(() => {
        detectChanges();
        expect(loadQueue).toHaveBeenCalledTimes(3);
        expect(reviewButton(approved).disabled).toBe(false);
        expect(rootElement().getAttribute('aria-busy')).toBeNull();
        expect(
          rootElement().textContent?.replaceAll(/\s+/g, ' '),
        ).not.toContain(readFailureMessage);
      });
      const refreshedMessage = approved
        ? 'The event was approved. The review list has been refreshed.'
        : 'The event was returned to draft. The review list has been refreshed.';
      const feedback = rootElement().querySelector(
        '[data-testid="event-review-action-message"]',
      );
      expect(feedback?.textContent).toContain(refreshedMessage);
      expect(feedback?.textContent).not.toContain('Load latest reviews');
      expect(feedback?.textContent).not.toContain(
        'outcome is still unconfirmed',
      );
      expectSingleMutation(approved);
      expect(reviewedNotice).not.toHaveBeenCalled();
      if (!approved) {
        expect(commentField(await openReturnDialog()).value).toBe(comment);
        await cancelDialog();
      }
    },
  );

  it('preserves conflict feedback when follow-up reads fail without claiming the latest details were loaded', async () => {
    await render();
    const message =
      'The event is no longer pending review. Open it to check its current status.';
    review.mockRejectedValueOnce(new EventConflictError({ message }));
    loadQueue.mockRejectedValueOnce(
      new Error('Private conflict refresh failure.'),
    );
    await confirmAction(true);
    await expectFeedback(message);
    expect(rootElement().textContent?.replaceAll(/\s+/g, ' ')).toContain(
      readFailureMessage,
    );
    expect(rootElement().textContent).not.toContain('We loaded the latest');
    expect(rootElement().textContent).not.toContain('Private conflict');
    expectSingleMutation(true);
    expect(reviewedNotice).not.toHaveBeenCalled();

    buttonNamed(rootElement(), 'Load latest reviews').click();
    await vi.waitFor(() => {
      detectChanges();
      expect(loadQueue).toHaveBeenCalledTimes(3);
      expect(rootElement().getAttribute('aria-busy')).toBeNull();
    });
    expectSingleMutation(true);
    expect(
      rootElement().querySelector('[data-testid="event-review-action-message"]')
        ?.textContent,
    ).toContain('The review list has been refreshed. ' + message);
    expect(rootElement().textContent).not.toContain(readFailureMessage);
    expect(reviewButton(true).disabled).toBe(false);
  });

  it('keeps every review action busy until failed and held sibling reads both settle', async () => {
    await render();
    const firstListRead = vi
      .fn<() => Promise<EventList>>()
      .mockResolvedValue([]);
    const secondListRead = vi
      .fn<() => Promise<EventList>>()
      .mockResolvedValue([]);
    const listOptions = (
      offset: number,
      queryFn: () => Promise<EventList>,
    ): ReturnType<Rpc['events']['eventList']['queryOptions']> => ({
      queryFn,
      queryKey: [
        ['events', 'eventList'],
        {
          input: {
            limit: 100,
            offset,
            startAfter: '2030-01-01T00:00:00.000Z',
            status: [],
          },
          type: 'query',
        },
      ],
    });
    const firstObserver = new QueryObserver(
      queryClient,
      listOptions(0, firstListRead),
    );
    const secondObserver = new QueryObserver(
      queryClient,
      listOptions(100, secondListRead),
    );
    let firstStatus = 'pending';
    let secondStatus = 'pending';
    const stopFirst = firstObserver.subscribe((result) => {
      firstStatus = result.status;
    });
    const stopSecond = secondObserver.subscribe((result) => {
      secondStatus = result.status;
    });
    let releaseRead: ((value: EventList) => void) | undefined;
    // Angular's browser target does not expose Promise.withResolvers.
    // eslint-disable-next-line unicorn/prefer-promise-with-resolvers
    const heldRead = new Promise<EventList>((resolve) => {
      releaseRead = resolve;
    });
    const failures: unknown[] = [];
    try {
      await vi.waitFor(() => {
        expect(firstStatus).toBe('success');
        expect(secondStatus).toBe('success');
      });
      firstListRead.mockRejectedValueOnce(new Error('First list read failed.'));
      secondListRead.mockReturnValueOnce(heldRead);
      await confirmAction(true);
      await vi.waitFor(() => {
        detectChanges();
        expect(firstStatus).toBe('error');
        expect(secondListRead).toHaveBeenCalledTimes(2);
        expect(loadQueue).toHaveBeenCalledTimes(2);
      });
      expect(rootElement().getAttribute('aria-busy')).toBe('true');
      for (const title of ['First workshop', 'Second workshop']) {
        for (const approved of [true, false]) {
          const button = reviewButton(approved, title);
          expect(button.disabled).toBe(true);
          button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        }
      }
      expect(dialog.openDialogs).toHaveLength(0);
      expectSingleMutation(true);
      expect(reviewedNotice).not.toHaveBeenCalled();
      expect(errorNotice).not.toHaveBeenCalled();
    } catch (error) {
      failures.push(error);
    } finally {
      releaseRead?.([]);
      await heldRead;
      try {
        await vi.waitFor(() => {
          detectChanges();
          expect(queryClient.isFetching()).toBe(0);
          expect(rootElement().getAttribute('aria-busy')).toBeNull();
        });
      } catch (error) {
        failures.push(error);
      }
      stopFirst();
      stopSecond();
    }
    if (failures.length > 0)
      throw new AggregateError(
        failures,
        'Review read ownership or cleanup failed',
      );
    await expectFeedback(
      'The event was approved. Load the latest reviews before making another change.',
    );
    expectSingleMutation(true);
    expect(reviewedNotice).not.toHaveBeenCalled();
  });
});
