import { eq } from 'drizzle-orm';

import { getId } from '../../../helpers/get-id';
import { userStateFile, usersToAuthenticate } from '../../../helpers/user-data';
import * as schema from '../../../src/db/schema';
import { expect, test } from '../../support/fixtures/parallel-test';
import { seedFreeAddonRegistrationEvent } from '../../support/utils/seed-registration-addons';
import { futureServerEventWindow } from '../../support/utils/server-test-clock';
import {
  closeApplicationContext,
  routeLocalTenantRequests,
} from '../../support/utils/tenant-request-routing';

test.use({ storageState: userStateFile });

test('reveals joining details only to the current confirmed ticket holder, including in SSR payloads', async ({
  browser,
  database,
  page,
  registerDatabaseCleanup,
  seeded,
  tenant,
}) => {
  const user = usersToAuthenticate.find(
    (candidate) => candidate.roles === 'user',
  );
  if (!user) throw new Error('Expected the regular participant');
  const event = await seedFreeAddonRegistrationEvent({
    database,
    registerDatabaseCleanup,
    sourceEventId: seeded.scenario.events.freeOpen.eventId,
    sourceOptionId: seeded.scenario.events.freeOpen.optionId,
    tenantId: tenant.id,
    window: futureServerEventWindow(),
  });
  const address = 'Private Court 17';
  const instructions = 'Use the private side gate.';
  await database
    .update(schema.eventInstances)
    .set({
      location: {
        type: 'coordinate',
        name: 'Ticket holders entrance',
        address,
        coordinates: { lat: 48, lng: 11 },
      },
    })
    .where(eq(schema.eventInstances.id, event.eventId));
  await database
    .update(schema.eventRegistrationOptions)
    .set({ registeredDescription: `<p>${instructions}</p>` })
    .where(eq(schema.eventRegistrationOptions.id, event.optionId));
  const url = `/events/${event.eventId}`;
  const initial = await page.goto(url);
  expect(await initial?.text()).not.toContain(address);
  expect(await initial?.text()).not.toContain(instructions);
  await expect(
    page.getByRole('region', { name: 'Meeting point', exact: true }),
  ).toHaveCount(0);

  const registrationId = getId();
  await database.insert(schema.eventRegistrations).values({
    basePriceAtRegistration: 0,
    discountAmount: 0,
    id: registrationId,
    eventId: event.eventId,
    registrationOptionId: event.optionId,
    tenantId: tenant.id,
    userId: user.id,
    status: 'WAITLIST',
  });
  for (const status of [
    'WAITLIST',
    'PENDING',
    'CONFIRMED',
    'CANCELLED',
  ] as const) {
    if (status === 'PENDING')
      await database
        .update(schema.eventRegistrationOptions)
        .set({ registrationMode: 'application' })
        .where(eq(schema.eventRegistrationOptions.id, event.optionId));
    await database
      .update(schema.eventRegistrations)
      .set({ status })
      .where(eq(schema.eventRegistrations.id, registrationId));
    const response = await page.reload();
    const html = await response?.text();
    if (status === 'CONFIRMED') {
      expect(html).toContain(address);
      await expect(
        page.getByRole('region', { name: 'Meeting point', exact: true }),
      ).toContainText(address);
      await expect(
        page.getByRole('img', {
          name: 'QR code for your event ticket',
          exact: true,
        }),
      ).toBeVisible();
      const pass = page.getByRole('img', {
        name: 'QR code for your event ticket',
        exact: true,
      });
      const description = page.getByRole('region', {
        name: 'Event details',
        exact: true,
      });
      await page.setViewportSize({ width: 1800, height: 1000 });
      await expect(async () => {
        const passBox = await pass.boundingBox();
        const descriptionBox = await description.boundingBox();
        if (!passBox || !descriptionBox)
          throw new Error(
            'Expected the pass and event description to have layout',
          );
        expect(passBox.x).toBeGreaterThan(
          descriptionBox.x + descriptionBox.width,
        );
      }).toPass();
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(async () => {
        const passBox = await pass.boundingBox();
        const descriptionBox = await description.boundingBox();
        if (!passBox || !descriptionBox)
          throw new Error(
            'Expected the pass and event description to have layout',
          );
        expect(passBox.y + passBox.height).toBeLessThan(844);
        expect(passBox.y).toBeLessThan(descriptionBox.y);
        const cancellation = await page
          .getByRole('button', { name: 'Cancel ticket', exact: true })
          .boundingBox();
        if (cancellation)
          expect(cancellation.y).toBeGreaterThan(descriptionBox.y);
      }).toPass();
      await expect(
        page
          .getByRole('navigation', { name: 'Event navigation' })
          .getByRole('link', { name: 'Events', exact: true }),
      ).toBeVisible();
      await page.setViewportSize({ width: 1280, height: 720 });
    } else {
      expect(html).not.toContain(address);
      expect(html).not.toContain(instructions);
      await expect(
        page.getByRole('region', { name: 'Meeting point', exact: true }),
      ).toHaveCount(0);
    }
  }

  const baseUrl = new URL(page.url()).origin;
  const visitor = await browser.newContext({
    baseURL: baseUrl,
    javaScriptEnabled: false,
    storageState: { cookies: [], origins: [] },
  });
  try {
    await database
      .update(schema.eventRegistrations)
      .set({ status: 'CONFIRMED' })
      .where(eq(schema.eventRegistrations.id, registrationId));
    await routeLocalTenantRequests({
      baseUrl,
      context: visitor,
      tenantDomain: tenant.domain,
    });
    const visitorPage = await visitor.newPage();
    const response = await visitorPage.goto(url);
    expect(await response?.text()).not.toContain(address);
    await expect(
      visitorPage.getByRole('region', { name: 'Meeting point', exact: true }),
    ).toHaveCount(0);
  } finally {
    await closeApplicationContext(visitor);
  }
});
