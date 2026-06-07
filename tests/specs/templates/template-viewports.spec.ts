import { adminStateFile } from '../../../helpers/user-data';
import { expect, test } from '../../support/fixtures/parallel-test';
import {
  collectBrowserLogFailures,
  expectedStablePageLayout,
  readPageLayout,
} from '../../support/utils/page-layout';

test.setTimeout(120_000);

test.use({ storageState: adminStateFile });

const viewportSizes = [
  { height: 740, label: 'narrow mobile', width: 320 },
  { height: 844, label: 'mobile', width: 390 },
  { height: 900, label: 'desktop', width: 1440 },
] as const;

test('template pages have stable layouts across viewports @templates', async ({
  page,
  templateCategories,
  templates,
}) => {
  const browserLogFailures = collectBrowserLogFailures(page);
  const category = templateCategories[0];
  if (!category) {
    throw new Error('Expected seeded template category for viewport coverage');
  }
  const template = templates[0];
  if (!template) {
    throw new Error('Expected seeded template for viewport coverage');
  }

  const routes = [
    {
      expectedHeading: 'Event templates',
      extraText: category.title,
      path: '/templates',
    },
    {
      expectedHeading: 'Create template',
      extraText: 'Simple Registration Setup',
      path: '/templates/create',
    },
    {
      expectedHeading: 'Template Categories',
      extraText: 'Create category',
      path: '/templates/categories',
    },
    {
      expectedHeading: 'Create template',
      extraText: 'Template Category',
      path: `/templates/create/${category.id}`,
    },
    {
      expectedHeading: template.title,
      extraText: 'Registration Options',
      path: `/templates/${template.id}`,
    },
    {
      expectedHeading: 'Edit template',
      extraText: 'Reusable add-ons',
      path: `/templates/${template.id}/edit`,
    },
    {
      expectedHeading: `Create ${template.title} event`,
      extraText: 'Event Details',
      path: `/templates/${template.id}/create-event`,
    },
  ] as const;

  for (const viewport of viewportSizes) {
    await test.step(`${viewport.label} viewport`, async () => {
      await page.setViewportSize(viewport);

      for (const route of routes) {
        await test.step(route.path, async () => {
          browserLogFailures.length = 0;
          await page.goto(route.path);

          await expect(
            page.getByRole('heading', {
              level: 1,
              name: route.expectedHeading,
            }),
          ).toBeVisible();
          await expect(
            page.getByText(route.extraText, { exact: false }).first(),
          ).toBeVisible();
          await expect(readPageLayout(page)).resolves.toEqual(
            expectedStablePageLayout,
          );
          expect(
            browserLogFailures,
            `${viewport.label} ${route.path} should not emit browser warning/error logs`,
          ).toEqual([]);
        });
      }
    });
  }
});
