import { gaStateFile } from '../../../helpers/user-data';
import { expect, test } from '../../support/fixtures/parallel-test';

test.use({ storageState: gaStateFile });

test('platform administrator opens target operations, refund recovery, and a deterministic scanner result @admin @globalAdmin', async ({
  page,
  registrations,
  tenant,
}) => {
  const registration =
    registrations.find((candidate) => candidate.status === 'CONFIRMED') ??
    registrations[0];
  if (!registration) {
    throw new Error('Expected a seeded registration for platform inspection');
  }

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
      'Only terminal Stripe refunds and exhausted, unleased refund processing appear here.',
      { exact: false },
    ),
  ).toBeVisible();

  await page.goto(`/global-admin/tenants/${tenant.id}/scanner`);
  await expect(page).toHaveURL(
    new RegExp(`/global-admin/tenants/${tenant.id}/scanner$`),
  );
  await page
    .getByLabel('Registration ID or result URL')
    .fill(`http://localhost:4200/scan/registration/${registration.id}`);
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
});
