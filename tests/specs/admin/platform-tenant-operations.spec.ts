import { and, eq } from 'drizzle-orm';

import { gaStateFile } from '../../../helpers/user-data';
import * as schema from '../../../src/db/schema';
import { expect, test } from '../../support/fixtures/parallel-test';

const platformScannerStatusGuidance = [
  {
    body: 'This ticket is not confirmed yet and cannot be checked in. Ask the attendee to open the event or Profile to see whether organizer approval or their existing Stripe Checkout is still needed. Do not start a second registration or payment from the scanner.',
    status: 'PENDING',
    title: 'Registration pending',
  },
  {
    body: 'This attendee does not have a confirmed spot yet and cannot be checked in. Review the waitlist and capacity. Do not take payment or create another registration from the scanner.',
    status: 'WAITLIST',
    title: 'Registration on waitlist',
  },
  {
    body: 'This ticket was cancelled and cannot be checked in. Do not ask the attendee to pay or register again. If the cancellation or refund looks wrong, review the existing registration and refund instead of creating a replacement.',
    status: 'CANCELLED',
    title: 'Registration cancelled',
  },
] as const;

test.use({ storageState: gaStateFile });

test('platform administrator opens target operations, refund recovery, and a deterministic scanner result @admin @globalAdmin', async ({
  database,
  page,
  registerDatabaseCleanup,
  registrations,
  tenant,
}) => {
  const registration =
    registrations.find((candidate) => candidate.status === 'CONFIRMED') ??
    registrations[0];
  if (!registration) {
    throw new Error('Expected a seeded registration for platform inspection');
  }
  registerDatabaseCleanup(async (cleanupDatabase) => {
    await cleanupDatabase
      .update(schema.eventRegistrations)
      .set({ status: registration.status })
      .where(
        and(
          eq(schema.eventRegistrations.id, registration.id),
          eq(schema.eventRegistrations.tenantId, tenant.id),
        ),
      );
  });

  await page.goto(`/global-admin/tenants/${tenant.id}`);
  await expect(
    page.getByRole('navigation', { name: 'Target tenant operations' }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Manage events' }),
  ).toHaveAttribute('href', `/global-admin/tenants/${tenant.id}/events`);
  await expect(
    page.getByRole('link', { name: 'Manage templates' }),
  ).toHaveAttribute('href', `/global-admin/tenants/${tenant.id}/templates`);
  await expect(
    page.getByRole('link', { name: 'Inspect registrations' }),
  ).toHaveAttribute('href', `/global-admin/tenants/${tenant.id}/scanner`);
  await expect(
    page.getByRole('link', { name: 'Review finance' }),
  ).toHaveAttribute('href', `/global-admin/tenants/${tenant.id}/finance`);

  await page.getByRole('link', { name: 'Review finance' }).click();
  await expect(page).toHaveURL(
    new RegExp(`/global-admin/tenants/${tenant.id}/finance$`),
  );
  await expect(
    page.getByRole('heading', { level: 1, name: 'Tenant finance' }),
  ).toBeVisible();
  await page.getByRole('tab', { name: 'Refund recovery' }).click();
  await expect(
    page.getByText(
      'Only terminal Stripe refunds and stopped, unleased refund processing appear here.',
      { exact: false },
    ),
  ).toBeVisible();

  await page.goto(`/global-admin/tenants/${tenant.id}/scanner`);
  await expect(page).toHaveURL(
    new RegExp(`/global-admin/tenants/${tenant.id}/scanner$`),
  );
  const lookupInput = page.getByLabel('Registration ID or result URL');
  await expect(lookupInput).toBeEnabled();
  await lookupInput.fill(
    `http://localhost:4200/scan/registration/${registration.id}`,
  );
  await page.getByRole('button', { name: 'Inspect' }).click();

  await expect(page).toHaveURL(
    new RegExp(
      `/global-admin/tenants/${tenant.id}/scanner/${registration.id}$`,
    ),
  );
  await expect(
    page.getByRole('heading', { level: 1, name: 'Registration inspection' }),
  ).toBeVisible();
  await expect(page.getByText(registration.id, { exact: true })).toBeVisible();

  const scanner = page.locator('app-platform-scanner');
  const registrationDetail = scanner.locator('section').filter({
    has: page.getByRole('heading', {
      name: 'Platform registration actions',
    }),
  });
  for (const guidance of platformScannerStatusGuidance) {
    await database
      .update(schema.eventRegistrations)
      .set({ status: guidance.status })
      .where(
        and(
          eq(schema.eventRegistrations.id, registration.id),
          eq(schema.eventRegistrations.tenantId, tenant.id),
        ),
      );
    await page.reload();

    await expect(
      registrationDetail.getByText(guidance.status, { exact: true }),
    ).toBeVisible();
    const statusAlert = registrationDetail.getByRole('alert');
    await expect(statusAlert).toContainText(guidance.title);
    await expect(statusAlert).toContainText(guidance.body);
  }
});
