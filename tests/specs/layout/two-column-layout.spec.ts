import { adminStateFile } from '../../../helpers/user-data';
import { expect, test } from '../../support/fixtures/parallel-test';

test.use({ storageState: adminStateFile });

test('template header and footer remain visible while its list scrolls', async ({
  database,
  page,
  tenant,
}) => {
  await page.setViewportSize({ width: 1280, height: 600 });
  const template = await database.query.eventTemplates.findFirst({
    where: { tenantId: tenant.id },
  });
  if (!template) throw new Error('Expected a template');
  await page.goto(`/templates/${template.id}`, { waitUntil: 'networkidle' });
  const list = page.getByRole('region', { name: 'Template list', exact: true });
  const detail = page.getByRole('region', {
    name: 'Selected template',
    exact: true,
  });
  const heading = page.getByRole('heading', {
    name: 'Event templates',
    exact: true,
  });
  await expect(heading).toBeVisible();
  await expect(list.getByRole('link', { name: template.title })).toBeVisible();
  await expect
    .poll(() =>
      list.evaluate((element) => element.scrollHeight > element.clientHeight),
    )
    .toBe(true);
  const headingTop = (await heading.boundingBox())?.y;
  await list.focus();
  await expect(list).toBeFocused();
  await page.keyboard.press('PageDown');
  await expect
    .poll(() => list.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  await expect(heading).toBeInViewport();
  expect((await heading.boundingBox())?.y).toBe(headingTop);
  expect(await detail.evaluate((element) => element.scrollTop)).toBe(0);
  await expect(
    page.getByRole('navigation', { name: 'Legal information' }),
  ).toBeInViewport();
  await detail.click({ position: { x: 2, y: 2 } });
  await expect(detail).toBeFocused();
  await expect(detail).toHaveCSS('outline-style', 'none');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(detail).toBeFocused();
  await expect(detail).not.toHaveCSS('outline-style', 'none');
});

for (const javaScriptEnabled of [true, false]) {
  test.describe(
    javaScriptEnabled ? 'Client navigation' : 'Server-rendered navigation',
    () => {
      test.use({ javaScriptEnabled });
      test('mobile template navigation yields to detail and returns with Back', async ({
        database,
        page,
        tenant,
      }) => {
        const template = await database.query.eventTemplates.findFirst({
          where: { tenantId: tenant.id },
        });
        if (!template) throw new Error('Expected a template');
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto('/templates');
        const list = page.getByRole('region', {
          name: 'Template list',
          exact: true,
        });
        await list.getByRole('link', { name: template.title }).click();
        await expect(page).toHaveURL(`/templates/${template.id}`);
        await expect(
          page.getByRole('heading', { name: 'Event templates', exact: true }),
        ).toBeHidden();
        await expect(list).toBeHidden();
        await expect(
          page.getByRole('region', { name: 'Selected template', exact: true }),
        ).toBeVisible();
        await page.goBack();
        await expect(
          page.getByRole('heading', { name: 'Event templates', exact: true }),
        ).toBeVisible();
        await expect(list).toBeVisible();
      });
    },
  );
}

test('settings keep their navigation header visible while the document scrolls', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 500 });
  await page.goto('/admin/settings/legal');
  const heading = page.getByRole('heading', {
    name: 'Admin settings',
    exact: true,
  });
  await expect(heading).toBeVisible();
  await page
    .getByRole('heading', { name: 'Legal pages', exact: true, level: 1 })
    .hover();
  await page.mouse.wheel(0, 450);
  await expect
    .poll(() => page.evaluate(() => window.scrollY))
    .toBeGreaterThan(0);
  await expect(heading).toBeInViewport();
  await expect(
    page.getByRole('link', { name: 'Members', exact: true }),
  ).toBeInViewport();
});
