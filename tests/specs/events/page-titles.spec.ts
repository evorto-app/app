import { inArray } from 'drizzle-orm';

import * as schema from '../../../src/db/schema';
import { expect, test } from '../../support/fixtures/parallel-test';

test.use({ storageState: { cookies: [], origins: [] } });

test('keeps browser titles aligned with event selection, history, list returns and unavailable pages', async ({
  database,
  page,
  seeded,
  tenant,
}) => {
  const eventIds = [
    seeded.scenario.events.freeOpen.eventId,
    seeded.scenario.events.paidOpen.eventId,
  ];
  const events = eventIds.map((id) => {
    const event = seeded.events.find((candidate) => candidate.id === id);
    if (!event) throw new Error('Expected the seeded public event');
    return event;
  });
  await database
    .update(schema.eventInstances)
    .set({
      start: new Date(Date.now() + 7 * 86_400_000),
      end: new Date(Date.now() + 7 * 86_400_000 + 3_600_000),
    })
    .where(inArray(schema.eventInstances.id, eventIds));
  const first = events[0];
  const second = events[1];
  if (!first || !second || first.id === second.id)
    throw new Error('Expected two distinct public events');
  const title = (label: string) => `${label} | ${tenant.name}`;
  const response = await page.goto(`/events/${first.id}`);
  expect(await response?.text()).toContain(
    `<title>${title(first.title)}</title>`,
  );
  await expect(page).toHaveTitle(title(first.title));
  await page
    .locator(`app-event-list nav a[href="/events/${second.id}"]`)
    .click();
  await expect(page).toHaveTitle(title(second.title));
  await expect(
    page.getByRole('heading', { name: second.title, exact: true, level: 1 }),
  ).toBeVisible();
  await page.goBack();
  await expect(page).toHaveTitle(title(first.title));
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Events', exact: true })
    .click();
  await expect(page).toHaveTitle(title('Events'));
  await page.goto('/events/event-that-does-not-exist');
  await expect(page).toHaveTitle(title('Event not found'));
  await page.getByRole('link', { name: 'Back to events', exact: true }).click();
  await expect(page).toHaveTitle(title('Events'));
  await page.getByRole('link', { name: 'Privacy', exact: true }).click();
  await expect(page).toHaveTitle(title('Privacy'));
  await page.goto('/page-that-does-not-exist');
  await expect(page).toHaveTitle(title('Page not found'));
});
