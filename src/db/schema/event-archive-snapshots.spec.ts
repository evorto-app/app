import { describe, expect, it } from '@effect/vitest';
import { readFileSync } from 'node:fs';

describe('event archive snapshot schema', () => {
  it('stores non-personal event archival summaries', () => {
    const source = readFileSync(
      new URL('event-archive-snapshots.ts', import.meta.url),
      'utf8',
    );

    expect(source).toContain(
      "eventArchiveSnapshots = pgTable('event_archive_snapshots'",
    );
    expect(source).toContain('EventArchiveOptionSummary');
    expect(source).toContain('EventArchiveRegistrationSummary');
    expect(source).toContain('checkedInSpots');
    expect(source).toContain('guestSpots');
    expect(source).toContain('waitlistedRegistrations');
  });

  it('does not copy user identity fields into archive records', () => {
    const source = readFileSync(
      new URL('event-archive-snapshots.ts', import.meta.url),
      'utf8',
    );

    expect(source).not.toMatch(
      /userId|creatorId|reviewedBy|email|firstName|lastName/u,
    );
  });
});
