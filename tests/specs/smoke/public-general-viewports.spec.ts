import type { Page } from '@playwright/test';

import { expect, test } from '../../support/fixtures/parallel-test';
import {
  expectedStablePageLayout,
  readPageLayout,
} from '../../support/utils/page-layout';

test.setTimeout(120_000);

const viewportSizes = [
  { height: 740, label: 'narrow mobile', width: 320 },
  { height: 844, label: 'mobile', width: 390 },
  { height: 900, label: 'desktop', width: 1440 },
] as const;

const expectAnonymousNavigation = async (
  page: Page,
  viewport: (typeof viewportSizes)[number],
) => {
  const navigation = page.locator('.navigation');
  await expect(navigation).toBeVisible();
  await expect(navigation.getByRole('link', { name: 'Events' })).toBeVisible();
  await expect(navigation.getByRole('link', { name: 'Login' })).toBeVisible();

  const position = await navigation.evaluate((element) => {
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();

    return {
      bottom: Math.round(rect.bottom),
      left: Math.round(rect.left),
      position: style.position,
      right: Math.round(rect.right),
      top: Math.round(rect.top),
    };
  });

  expect(position.position).toBe('fixed');
  if (viewport.width < 1024) {
    expect(position.left).toBe(0);
    expect(position.right).toBe(viewport.width);
    expect(position.bottom).toBe(viewport.height);
  } else {
    expect(position.left).toBe(0);
    expect(position.top).toBe(0);
  }
};

test('public General pages have stable layouts across viewports', async ({
  page,
  seeded,
}) => {
  const freeOpenEvent = seeded.events.find(
    (event) => event.id === seeded.scenario.events.freeOpen.eventId,
  );
  if (!freeOpenEvent) {
    throw new Error(
      'Expected seeded public event for General viewport coverage',
    );
  }

  const publicRoutes = [
    {
      name: 'root redirect',
      path: '/',
      expectedText: 'Events',
      extraText: 'Soccer Match',
    },
    {
      name: 'events list',
      path: '/events',
      expectedText: 'Events',
      extraText: 'Soccer Match',
    },
    {
      name: 'event detail',
      path: `/events/${freeOpenEvent.id}`,
      expectedText: freeOpenEvent.title,
      extraText: 'Log in now',
    },
    {
      name: 'imprint legal page',
      path: '/legal/imprint',
      expectedText: 'Imprint',
      extraText: 'No tenant-provided legal text is configured for this page.',
    },
    {
      name: 'privacy legal page',
      path: '/legal/privacy',
      expectedText: 'Privacy policy',
      extraText: 'No tenant-provided legal text is configured for this page.',
    },
    {
      name: 'terms legal page',
      path: '/legal/terms',
      expectedText: 'Terms',
      extraText: 'No tenant-provided legal text is configured for this page.',
    },
    {
      name: 'access not allowed page',
      path: '/403',
      expectedText: 'Access not allowed',
      extraText: 'Your account does not have permission to open this page.',
    },
    {
      name: 'server error page',
      path: '/500',
      expectedText: 'Something went wrong',
      extraText: 'Please try again later.',
    },
    {
      name: 'not found page',
      path: '/404',
      expectedText: 'Page not found',
      extraText: 'The page you are looking for doesn’t exist.',
    },
    {
      name: 'wildcard not found redirect',
      path: '/missing-general-page',
      expectedText: 'Page not found',
      extraText: 'The page you are looking for doesn’t exist.',
    },
  ] as const;

  for (const viewport of viewportSizes) {
    await test.step(`${viewport.label} viewport`, async () => {
      await page.setViewportSize(viewport);

      for (const route of publicRoutes) {
        await test.step(route.name, async () => {
          await page.goto(route.path);

          await expect(
            page.getByRole('heading', { name: route.expectedText }).first(),
          ).toBeVisible({ timeout: 15_000 });
          await expect(
            page.getByText(route.extraText, { exact: false }).first(),
          ).toBeVisible({ timeout: 15_000 });
          await expectAnonymousNavigation(page, viewport);

          await expect(readPageLayout(page)).resolves.toEqual(
            expectedStablePageLayout,
          );
        });
      }
    });
  }
});
