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

const blockedConsoleTypes = new Set(['error', 'warning']);

const collectBrowserLogFailures = (page: Page): string[] => {
  const browserLogFailures: string[] = [];

  page.on('console', (message) => {
    if (!blockedConsoleTypes.has(message.type())) {
      return;
    }

    const location = message.location();
    const source = location.url
      ? `${location.url}:${location.lineNumber}:${location.columnNumber}`
      : page.url();
    browserLogFailures.push(`${message.type()}: ${message.text()} (${source})`);
  });

  return browserLogFailures;
};

const expectReadableTextOnPaintedSurface = async (
  page: Page,
  selector: string,
) => {
  const contrastReport = await page.locator(selector).evaluate((element) => {
    const parseRgb = (value: string) => {
      const match = value.match(
        /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([.\d]+))?\)$/u,
      );

      if (!match) {
        return undefined;
      }

      return {
        alpha: match[4] === undefined ? 1 : Number(match[4]),
        blue: Number(match[3]),
        green: Number(match[2]),
        red: Number(match[1]),
      };
    };
    const luminance = (channel: number) => {
      const normalized = channel / 255;

      return normalized <= 0.03928
        ? normalized / 12.92
        : ((normalized + 0.055) / 1.055) ** 2.4;
    };
    const relativeLuminance = (color: {
      blue: number;
      green: number;
      red: number;
    }) =>
      0.2126 * luminance(color.red) +
      0.7152 * luminance(color.green) +
      0.0722 * luminance(color.blue);
    const contrastRatio = (
      foreground: { blue: number; green: number; red: number },
      background: { blue: number; green: number; red: number },
    ) => {
      const foregroundLuminance = relativeLuminance(foreground);
      const backgroundLuminance = relativeLuminance(background);
      const lighter = Math.max(foregroundLuminance, backgroundLuminance);
      const darker = Math.min(foregroundLuminance, backgroundLuminance);

      return (lighter + 0.05) / (darker + 0.05);
    };
    const findPaintedBackground = (start: Element) => {
      let current: Element | null = start;

      while (current) {
        const background = parseRgb(
          window.getComputedStyle(current).backgroundColor,
        );
        if (background && background.alpha > 0) {
          return background;
        }

        current = current.parentElement;
      }

      return undefined;
    };
    const foreground = parseRgb(window.getComputedStyle(element).color);
    const background = findPaintedBackground(element);

    return {
      background,
      contrast:
        foreground && background ? contrastRatio(foreground, background) : 0,
      foreground,
      text: element.textContent?.trim().replace(/\s+/g, ' ').slice(0, 80),
    };
  });

  expect(
    contrastReport.background,
    `${selector} should render on a painted Material surface`,
  ).toBeDefined();
  expect(
    contrastReport.contrast,
    `${selector} should stay readable in the mobile General page`,
  ).toBeGreaterThanOrEqual(4.5);
};

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

  const browserLogFailures = collectBrowserLogFailures(page);

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
          browserLogFailures.length = 0;
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
          expect(
            browserLogFailures,
            `${viewport.label} ${route.name} should not emit browser warning/error logs`,
          ).toEqual([]);
        });
      }
    });
  }
});

test('public simple General pages remain readable in mobile Browser rendering', async ({
  page,
}) => {
  await page.setViewportSize({ height: 844, width: 390 });

  const simpleGeneralRoutes = [
    {
      extraText: 'No tenant-provided legal text is configured for this page.',
      heading: 'Terms',
      paragraphSelector: 'app-legal-page p',
      path: '/legal/terms',
      titleSelector: 'app-legal-page h1',
    },
    {
      extraText: 'Your account does not have permission to open this page.',
      heading: 'Access not allowed',
      paragraphSelector: 'app-not-allowed p',
      path: '/403',
      titleSelector: 'app-not-allowed h1',
    },
    {
      extraText: 'Please try again later.',
      heading: 'Something went wrong',
      paragraphSelector: 'app-error p',
      path: '/500',
      titleSelector: 'app-error h1',
    },
    {
      extraText: 'The page you are looking for doesn’t exist.',
      heading: 'Page not found',
      paragraphSelector: 'app-not-found p',
      path: '/404',
      titleSelector: 'app-not-found h1',
    },
  ] as const;

  for (const colorScheme of ['light', 'dark'] as const) {
    await test.step(`${colorScheme} color scheme`, async () => {
      await page.emulateMedia({ colorScheme });

      for (const route of simpleGeneralRoutes) {
        await test.step(route.path, async () => {
          await page.goto(route.path);

          await expect(
            page.getByRole('heading', { name: route.heading }),
          ).toBeVisible();
          await expect(page.getByText(route.extraText)).toBeVisible();
          await expectReadableTextOnPaintedSurface(page, route.titleSelector);
          await expectReadableTextOnPaintedSurface(
            page,
            route.paragraphSelector,
          );
          await expect(readPageLayout(page)).resolves.toEqual(
            expectedStablePageLayout,
          );
        });
      }
    });
  }
});
