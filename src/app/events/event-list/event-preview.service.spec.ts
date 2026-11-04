import type { EventsEventListRecord } from '@shared/rpc-contracts/app-rpcs/events.rpcs';

import { describe, expect, it } from 'vitest';

import {
  distinctEventPreviews,
  eventPreviewRelativeDate,
} from './event-preview.service';

const event = (id: string, iconName = id): EventsEventListRecord => ({
  announcementRoleCount: 0,
  hasRegistrationOptions: true,
  icon: { iconColor: 0, iconName },
  id,
  start: '2030-01-08T12:00:00.000Z',
  status: 'APPROVED',
  title: id,
  userSignUpState: null,
});

describe('event selection previews', () => {
  it('keeps the nearest upcoming event per icon and fills gaps from recent events', () => {
    expect(
      distinctEventPreviews(
        [
          event('next hike', 'mountain'),
          event('later hike', 'mountain'),
          event('next game', 'football2'),
        ],
        [
          event('past hike', 'mountain'),
          event('past trip', 'bus'),
          event('older trip', 'bus'),
        ],
      ).map((preview) => preview.id),
    ).toEqual(['next hike', 'next game', 'past trip']);
  });

  it('bounds the upcoming window and caps the distinct selection at eight', () => {
    const upcoming = Array.from({ length: 12 }, (_, i) =>
      event(`upcoming-${i}`, 'mountain'),
    );
    const recent = Array.from({ length: 12 }, (_, i) => event(`recent-${i}`));
    expect(
      distinctEventPreviews(upcoming, recent).map((preview) => preview.id),
    ).toEqual([
      'upcoming-0',
      ...recent.slice(0, 7).map((preview) => preview.id),
    ]);
    expect(distinctEventPreviews([], [])).toEqual([]);
  });

  it('uses calendar-relative dates in the organization timezone for upcoming and past events', () => {
    const now = '2030-01-01T12:00:00.000Z';
    expect(
      eventPreviewRelativeDate(
        '2030-01-02T12:00:00.000Z',
        now,
        'Europe/Berlin',
      ),
    ).toBe('tomorrow');
    expect(
      eventPreviewRelativeDate(
        '2030-01-08T12:00:00.000Z',
        now,
        'Europe/Berlin',
      ),
    ).toBe('next week');
    expect(
      eventPreviewRelativeDate(
        '2029-12-25T12:00:00.000Z',
        now,
        'Europe/Berlin',
      ),
    ).toBe('last week');
    expect(
      eventPreviewRelativeDate(
        '2030-01-02T00:30:00.000Z',
        '2030-01-01T23:30:00.000Z',
        'Europe/Berlin',
      ),
    ).toBe('today');
  });
});
