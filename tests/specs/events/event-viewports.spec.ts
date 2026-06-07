import { organizerStateFile } from '../../../helpers/user-data';
import { expect, test } from '../../support/fixtures/parallel-test';
import {
  collectBrowserLogFailures,
  expectedStablePageLayout,
  readPageLayout,
} from '../../support/utils/page-layout';

test.setTimeout(120_000);

test.use({ storageState: organizerStateFile });

const viewportSizes = [
  { height: 740, label: 'narrow mobile', width: 320 },
  { height: 844, label: 'mobile', width: 390 },
  { height: 900, label: 'desktop', width: 1440 },
] as const;

test('event pages have stable layouts across viewports @events', async ({
  events,
  page,
  seeded,
}) => {
  const browserLogFailures = collectBrowserLogFailures(page);
  const freeOpenEvent = events.find(
    (event) => event.id === seeded.scenario.events.freeOpen.eventId,
  );
  if (!freeOpenEvent) {
    throw new Error('Expected seeded open event for event viewport coverage');
  }

  const draftEvent = events.find(
    (event) => event.id === seeded.scenario.events.draft.eventId,
  );
  if (!draftEvent) {
    throw new Error('Expected seeded draft event for event viewport coverage');
  }

  const routes = [
    {
      expectedHeading: 'Events',
      extraText: freeOpenEvent.title,
      path: '/events',
    },
    {
      expectedHeading: freeOpenEvent.title,
      extraText: 'Registration',
      path: `/events/${freeOpenEvent.id}`,
    },
    {
      expectedHeading: draftEvent.title,
      extraText: 'Event Details',
      path: `/events/${draftEvent.id}/edit`,
    },
    {
      expectedHeading: freeOpenEvent.title,
      extraText: 'Participants',
      path: `/events/${freeOpenEvent.id}/organize`,
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
