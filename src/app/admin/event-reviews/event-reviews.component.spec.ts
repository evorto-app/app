import { readFileSync } from 'node:fs';
import nodePath from 'node:path';
import { describe, expect, it } from 'vitest';

import { eventReviewQueueActionDisabled } from './event-reviews.component';

describe('eventReviewQueueActionDisabled', () => {
  it('blocks review queue actions while a review mutation is pending', () => {
    expect(
      eventReviewQueueActionDisabled({
        actionPending: false,
        mutationPending: false,
      }),
    ).toBe(false);
    expect(
      eventReviewQueueActionDisabled({
        actionPending: false,
        mutationPending: true,
      }),
    ).toBe(true);
    expect(
      eventReviewQueueActionDisabled({
        actionPending: true,
        mutationPending: false,
      }),
    ).toBe(true);
  });

  it('names the return action after the state change it performs', () => {
    const queueSource = readFileSync(
      nodePath.join(
        process.cwd(),
        'src/app/admin/event-reviews/event-reviews.component.ts',
      ),
      'utf8',
    );
    const dialogSource = readFileSync(
      nodePath.join(
        process.cwd(),
        'src/app/events/event-review-dialog/event-review-dialog.component.ts',
      ),
      'utf8',
    );

    expect(queueSource).toContain('Return to draft');
    expect(dialogSource).toContain('Return event to draft');
    expect(dialogSource).toContain('Return to draft');
    expect(queueSource).not.toContain('Reject');
  });
});
