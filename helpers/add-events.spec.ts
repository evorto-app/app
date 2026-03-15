import { describe, expect, it } from '@effect/vitest';
import { DateTime } from 'luxon';

import { redistributeDemoEventTimeline } from './add-events';

const seedNow = DateTime.fromISO('2026-03-15T00:00:00.000Z', {
  zone: 'utc',
});

const buildStart = (dayOffset: number, hour: number, minute: number) =>
  seedNow
    .plus({ days: dayOffset })
    .set({
      hour,
      millisecond: 0,
      minute,
      second: 0,
    })
    .toJSDate();

const buildEvent = (
  id: string,
  title: string,
  status: 'APPROVED' | 'DRAFT' | 'PENDING_REVIEW',
  start: Date,
) => ({
  end: DateTime.fromJSDate(start, { zone: 'utc' }).plus({ hours: 6 }).toJSDate(),
  id,
  start,
  status,
  title,
});

const buildOption = (eventId: string, start: Date) => ({
  closeRegistrationTime: DateTime.fromJSDate(start, { zone: 'utc' })
    .minus({ hours: 2 })
    .toJSDate(),
  eventId,
  openRegistrationTime: DateTime.fromJSDate(start, { zone: 'utc' })
    .minus({ days: 14 })
    .toJSDate(),
});

describe('redistributeDemoEventTimeline', () => {
  it('redistributes demo events into a more natural timeline without breaking option timing', () => {
    const buildBatch = (
      count: number,
      prefix: string,
      status: 'APPROVED' | 'DRAFT' | 'PENDING_REVIEW',
      dayOffset: number,
    ) =>
      Array.from({ length: count }, (_, index) =>
        buildEvent(
          `${prefix}-${index + 1}`,
          `${prefix} ${index + 1}`,
          status,
          buildStart(dayOffset, 9 + (index % 8), (index % 4) * 15),
        ),
      );

    const events = [
      ...buildBatch(25, 'Approved upcoming', 'APPROVED', 7),
      ...buildBatch(25, 'Approved past', 'APPROVED', -3),
      ...buildBatch(25, 'Draft', 'DRAFT', 21),
      ...buildBatch(25, 'Pending', 'PENDING_REVIEW', 35),
    ];
    const registrationOptions = events.map((event) =>
      buildOption(event.id, event.start),
    );

    const redistributed = redistributeDemoEventTimeline(
      events,
      registrationOptions,
      seedNow,
    );
    const redistributedById = new Map(
      redistributed.events.map((event) => [event.id, event]),
    );
    const approvedPast = redistributed.events.filter(
      (event) => event.status === 'APPROVED' && event.start < seedNow.toJSDate(),
    );
    const approvedUpcoming = redistributed.events.filter(
      (event) => event.status === 'APPROVED' && event.start >= seedNow.toJSDate(),
    );
    const draft = redistributed.events.filter((event) => event.status === 'DRAFT');
    const pendingReview = redistributed.events.filter(
      (event) => event.status === 'PENDING_REVIEW',
    );
    const eventsByDay = new Map<string, number>();
    for (const event of redistributed.events) {
      const day = DateTime.fromJSDate(event.start, { zone: 'utc' }).toFormat(
        'yyyy-LL-dd',
      );
      eventsByDay.set(day, (eventsByDay.get(day) ?? 0) + 1);
    }

    expect(approvedPast.length).toBeGreaterThan(0);
    expect(
      Math.min(...draft.map((event) => event.start.getTime())),
    ).toBeLessThan(
      Math.max(...approvedUpcoming.map((event) => event.start.getTime())),
    );
    expect(
      Math.min(...pendingReview.map((event) => event.start.getTime())),
    ).toBeLessThan(
      Math.max(...draft.map((event) => event.start.getTime())),
    );
    expect([...eventsByDay.values()].every((count) => count <= 10)).toBe(true);

    const nearFutureMax = Math.max(
      ...[...eventsByDay.entries()]
        .filter(([day]) => {
          const dayOffset = Math.round(
            DateTime.fromFormat(day, 'yyyy-LL-dd', { zone: 'utc' })
              .diff(seedNow.startOf('day'), 'days')
              .days,
          );
          return dayOffset >= 2 && dayOffset <= 8;
        })
        .map(([, count]) => count),
    );
    const farFutureMax = Math.max(
      ...[...eventsByDay.entries()]
        .filter(([day]) => {
          const dayOffset = Math.round(
            DateTime.fromFormat(day, 'yyyy-LL-dd', { zone: 'utc' })
              .diff(seedNow.startOf('day'), 'days')
              .days,
          );
          return dayOffset >= 18;
        })
        .map(([, count]) => count),
    );

    expect(nearFutureMax).toBeGreaterThan(farFutureMax);

    for (const option of redistributed.registrationOptions) {
      const event = redistributedById.get(option.eventId);
      expect(event).toBeDefined();
      if (!event) {
        throw new Error(
          `Expected redistributed event for registration option ${option.eventId}`,
        );
      }

      const eventStart = DateTime.fromJSDate(event.start, { zone: 'utc' });
      const eventEnd = DateTime.fromJSDate(event.end, { zone: 'utc' });
      const openRegistrationTime = DateTime.fromJSDate(
        option.openRegistrationTime,
        { zone: 'utc' },
      );
      const closeRegistrationTime = DateTime.fromJSDate(
        option.closeRegistrationTime,
        { zone: 'utc' },
      );

      expect(eventEnd.toMillis() - eventStart.toMillis()).toBe(
        6 * 60 * 60 * 1000,
      );
      expect(eventStart.diff(openRegistrationTime, 'days').days).toBe(14);
      expect(eventStart.diff(closeRegistrationTime, 'hours').hours).toBe(2);
    }
  });
});
