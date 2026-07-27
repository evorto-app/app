import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { eventInstances, eventReviewStatus } from './event-instances';
import { eventTemplates } from './event-templates';
import { eventListingAudience } from './global-enums';

describe('eventReviewStatus', () => {
  it('stores only the active review states', () => {
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

  it('keeps optionless announcement discovery link-only by default', () => {
    const columns = getTableConfig(eventInstances).columns;
    const announcementRolesColumn = columns.find(
      (column) => column.name === 'announcementRoleIds',
    );

    expect(announcementRolesColumn?.notNull).toBe(true);
    expect(announcementRolesColumn?.default).toEqual([]);
    expect(
      getTableConfig(eventTemplates).columns.some(
        (column) => column.name === 'announcementRoleIds',
      ),
    ).toBe(false);
  });

  it('requires one explicit listing audience without a database fallback', () => {
    expect(eventListingAudience.enumValues).toEqual([
      'participant',
      'organizer',
      'both',
      'unlisted',
    ]);

    for (const table of [eventInstances, eventTemplates]) {
      const columns = getTableConfig(table).columns;
      const audienceColumn = columns.find(
        (column) => column.name === 'listingAudience',
      );

      expect(audienceColumn?.notNull).toBe(true);
      expect(audienceColumn?.default).toBeUndefined();
      expect(columns.some((column) => column.name === 'unlisted')).toBe(false);
    }
  });
});
