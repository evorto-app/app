import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { eventInstances, eventReviewStatus } from './event-instances';

describe('eventReviewStatus', () => {
  it('keeps rejection as a return to draft rather than a durable state', () => {
    expect(eventReviewStatus.enumValues).toEqual([
      'DRAFT',
      'PENDING_REVIEW',
      'APPROVED',
    ]);
  });

  it('persists an event-owned registration editor mode with a simple default', () => {
    const modeColumn = getTableConfig(eventInstances).columns.find(
      (column) => column.name === 'simpleModeEnabled',
    );

    expect(modeColumn?.notNull).toBe(true);
    expect(modeColumn?.default).toBe(true);
  });
});
