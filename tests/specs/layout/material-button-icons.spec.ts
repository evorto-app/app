import type { Locator } from '@playwright/test';

import { adminStateFile, gaStateFile } from '../../../helpers/user-data';
import { expect, test } from '../../support/fixtures/parallel-test';

const expectIconBesideLabel = async (
  action: Locator,
  labelText: string,
  size = 24,
) => {
  await expect(action).toBeVisible();
  const icon = action.locator('fa-duotone-icon, fa-icon');
  const label = action.getByText(labelText, { exact: true });
  await expect(icon).toBeVisible();
  await expect(label).toBeVisible();
  await action.evaluate(async () => {
    await document.fonts.ready;
  });
  const iconBox = await icon.boundingBox();
  const labelBox = await label.boundingBox();
  if (!iconBox || !labelBox)
    throw new Error('Expected a rendered icon and label');
  expect(iconBox.width).toBeCloseTo(size, 0);
  expect(iconBox.height).toBeCloseTo(size, 0);
  expect(labelBox.x - (iconBox.x + iconBox.width)).toBeGreaterThanOrEqual(7);
  expect(
    Math.abs(iconBox.y + iconBox.height / 2 - labelBox.y - labelBox.height / 2),
  ).toBeLessThan(2);
};

test.describe('Server-rendered floating actions', () => {
  test.use({ storageState: adminStateFile, javaScriptEnabled: false });

  for (const action of [
    { path: '/admin/roles', label: 'Create role', role: 'link' },
    { path: '/admin/tax-rates', label: 'Add tax rates', role: 'button' },
    { path: '/templates/categories', label: 'Create category', role: 'button' },
  ] as const) {
    test(`${action.label} keeps its icon beside the label without JavaScript`, async ({
      page,
    }) => {
      await page.goto(action.path);
      await expectIconBesideLabel(
        page.getByRole(action.role, { name: action.label, exact: true }),
        action.label,
      );
    });
  }

  test('Create event keeps its icon beside the label without JavaScript', async ({
    database,
    page,
    tenant,
  }) => {
    const template = await database.query.eventTemplates.findFirst({
      where: { tenantId: tenant.id },
    });
    if (!template) throw new Error('Expected a template');
    await page.goto(`/templates/${template.id}`);
    await expectIconBesideLabel(
      page.getByRole('link', { name: 'Create event', exact: true }),
      'Create event',
    );
  });

  test('mobile Create template keeps its icon beside the label without JavaScript', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/templates');
    await expectIconBesideLabel(
      page.getByRole('link', { name: 'Create template', exact: true }),
      'Create template',
    );
  });
});

test.describe('Platform floating action', () => {
  test.use({ storageState: gaStateFile, javaScriptEnabled: false });

  test('Create organization keeps its icon beside the label without JavaScript', async ({
    page,
  }) => {
    await page.goto('/global-admin/tenants');
    await expectIconBesideLabel(
      page.getByRole('link', { name: 'Create organization', exact: true }),
      'Create organization',
    );
  });
});

test.describe('Regular Material button icons', () => {
  test.use({ storageState: adminStateFile });

  test('profile buttons retain Material sizing and spacing', async ({
    page,
  }) => {
    await page.goto('/profile');
    const editProfile = page.getByRole('button', {
      name: 'Edit profile',
      exact: true,
    });
    await expect(editProfile).not.toHaveAttribute('jsaction', /click/, {
      timeout: 20_000,
    });
    await expectIconBesideLabel(editProfile, 'Edit profile', 18);
    await expectIconBesideLabel(
      page.getByRole('link', { name: 'Use transfer code', exact: true }),
      'Use transfer code',
      18,
    );
  });
});
