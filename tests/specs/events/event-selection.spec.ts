import { eq } from 'drizzle-orm';

import * as schema from '../../../src/db/schema';
import { expect, test as base } from '../../support/fixtures/parallel-test';
import { seedFreeAddonRegistrationEvent } from '../../support/utils/seed-registration-addons';
import { futureServerEventWindow } from '../../support/utils/server-test-clock';

const test = base.extend<{ selectionEvents: void }>({
  selectionEvents: [
    async ({ database, registerDatabaseCleanup, seeded, tenant }, use) => {
      for (const iconName of ['mountain', 'football2']) {
        const event = await seedFreeAddonRegistrationEvent({
          database,
          registerDatabaseCleanup,
          sourceEventId: seeded.scenario.events.freeOpen.eventId,
          sourceOptionId: seeded.scenario.events.freeOpen.optionId,
          tenantId: tenant.id,
          window: futureServerEventWindow(),
        });
        await database
          .update(schema.eventInstances)
          .set({ icon: { iconName, iconColor: 0 } })
          .where(eq(schema.eventInstances.id, event.eventId));
      }
      await use();
    },
    { auto: true },
  ],
});

test.use({
  storageState: { cookies: [], origins: [] },
  viewport: { height: 900, width: 1440 },
});

test('invites desktop selection, varies the illustration, and yields to event details', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/events');
  await page.waitForLoadState('networkidle');
  const prompt = page.getByRole('region', { name: 'What will you do next?' });
  await expect(prompt).toBeVisible();
  const illustration = prompt.locator('app-icon:not(.opacity-0) img');
  const shape = prompt.locator('app-shape path');
  const originalShape = await shape.getAttribute('d');
  const previewLink = prompt.getByRole('link');
  await expect(previewLink).toBeVisible();
  await expect(prompt.locator('time')).toHaveAttribute(
    'datetime',
    /\d{4}-\d{2}-\d{2}T/,
  );
  await expect(prompt.locator('time')).not.toBeEmpty();
  const originalIcon = await illustration.getAttribute('src');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(illustration).not.toHaveAttribute('src', originalIcon ?? '', {
    timeout: 10_000,
  });
  await expect(shape).not.toHaveAttribute('d', originalShape ?? '');

  const event = page
    .getByRole('region', { name: 'Event list', exact: true })
    .getByRole('link')
    .first();
  await expect(event).not.toHaveAttribute('jsaction', /click/);
  await event.click();
  await expect(page).toHaveURL(/\/events\/.+/);
  await expect(prompt).toHaveCount(0);
  await expect(
    page
      .getByRole('region', { name: 'Selected event', exact: true })
      .getByRole('heading', { level: 1 }),
  ).toBeVisible();

  await page.goto('/events');
  await expect(prompt).toBeVisible();
  await page.setViewportSize({ height: 844, width: 390 });
  await expect(prompt).toBeHidden();
  await expect(event).toBeVisible();
});

test('keeps the illustration still when reduced motion is requested', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/events');
  await page.waitForLoadState('networkidle');
  const prompt = page.getByRole('region', { name: 'What will you do next?' });
  await expect(prompt).toBeVisible();
  const illustration = prompt.locator('app-icon:not(.opacity-0) img');
  const originalIcon = await illustration.getAttribute('src');
  // Observe past a complete illustration cycle without replacing the fixture's clock.
  await page.waitForTimeout(7100);
  await expect(illustration).toHaveAttribute('src', originalIcon ?? '');
  await expect(prompt.locator('svg')).toHaveCSS('animation-name', 'none');
});

test.describe('Server-rendered event selection', () => {
  test.use({ javaScriptEnabled: false });

  test('shows the invitation and working event links without JavaScript', async ({
    page,
  }) => {
    await page.goto('/events');
    await expect(
      page.getByRole('heading', { name: 'What will you do next?' }),
    ).toBeVisible();
    const event = page
      .getByRole('region', { name: 'Event list', exact: true })
      .getByRole('link')
      .first();
    await event.click();
    await expect(
      page
        .getByRole('region', { name: 'Selected event', exact: true })
        .getByRole('heading', { level: 1 }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'What will you do next?' }),
    ).toHaveCount(0);
  });
});
