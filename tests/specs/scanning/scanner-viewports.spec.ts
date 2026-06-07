import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';

import { getId } from '../../../helpers/get-id';
import type { SeedTenantResult } from '../../../helpers/seed-tenant';
import {
  adminStateFile,
  usersToAuthenticate,
} from '../../../helpers/user-data';
import type { relations } from '../../../src/db/relations';
import {
  eventRegistrationOptions,
  eventRegistrations,
} from '../../../src/db/schema';
import { expect, test } from '../../support/fixtures/parallel-test';
import {
  collectBrowserLogFailures,
  expectStablePageLayout,
} from '../../support/utils/page-layout';

test.setTimeout(120_000);

test.use({ storageState: adminStateFile });

type TestDatabase = NodePgDatabase<typeof relations>;

const viewportSizes = [
  { height: 740, label: 'narrow mobile', width: 320 },
  { height: 844, label: 'mobile', width: 390 },
  { height: 900, label: 'desktop', width: 1440 },
] as const;

const expectedScannerCameraBrowserLogPatterns = [
  /camera stream is only accessible if the page is transferred via https/u,
  /Permissions policy violation: camera is not allowed in this document/u,
  /Failed to start QR scanner camera/u,
] as const;

const expectNoUnexpectedBrowserLogs = ({
  browserLogFailures,
  routePath,
  viewportLabel,
}: {
  browserLogFailures: string[];
  routePath: string;
  viewportLabel: string;
}) => {
  const unexpectedBrowserLogFailures =
    routePath === '/scan'
      ? browserLogFailures.filter(
          (failure) =>
            !expectedScannerCameraBrowserLogPatterns.some((pattern) =>
              pattern.test(failure),
            ),
        )
      : browserLogFailures;

  expect(
    unexpectedBrowserLogFailures,
    `${viewportLabel} ${routePath} should not emit browser warning/error logs except the expected scanner camera fallback`,
  ).toEqual([]);
};

const requireScannerFixture = async ({
  database,
  seeded,
}: {
  database: TestDatabase;
  seeded: SeedTenantResult;
}) => {
  const eventId = seeded.scenario.events.past.eventId;
  const event = seeded.events.find((seededEvent) => seededEvent.id === eventId);
  if (!event) {
    throw new Error('Expected seeded past event for scanner viewport coverage');
  }

  const registrationOption = event.registrationOptions.find(
    (option) => !option.organizingRegistration,
  );
  if (!registrationOption) {
    throw new Error(
      'Expected participant registration option for scanner viewport coverage',
    );
  }

  const optionBefore = await database.query.eventRegistrationOptions.findFirst({
    columns: {
      checkedInSpots: true,
    },
    where: {
      eventId,
      id: registrationOption.id,
    },
  });
  if (!optionBefore) {
    throw new Error(
      `Expected registration option "${registrationOption.id}" for seeded scanner viewport event`,
    );
  }

  const regularUser = usersToAuthenticate.find((user) => user.roles === 'user');
  if (!regularUser) {
    throw new Error(
      'Expected regular user fixture for scanner viewport coverage',
    );
  }

  return {
    eventId,
    optionBefore,
    registrationOptionId: registrationOption.id,
    tenantId: seeded.tenant.id,
    userId: regularUser.id,
  };
};

test('scanner pages have stable layouts across viewports @scanning', async ({
  database,
  page,
  seeded,
}) => {
  const browserLogFailures = collectBrowserLogFailures(page);
  const scannerFixture = await requireScannerFixture({ database, seeded });
  const registrationId = getId();

  try {
    await database.insert(eventRegistrations).values({
      checkedInGuestCount: 0,
      eventId: scannerFixture.eventId,
      guestCount: 2,
      id: registrationId,
      registrationOptionId: scannerFixture.registrationOptionId,
      status: 'CONFIRMED',
      tenantId: scannerFixture.tenantId,
      userId: scannerFixture.userId,
    });

    const routes = [
      {
        expectedHeading: 'Scanner',
        extraText: 'Please allow access to your camera',
        path: '/scan',
      },
      {
        expectedHeading: 'Registration scanned',
        extraText: 'Includes 2 guests',
        path: `/scan/registration/${registrationId}`,
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
            await expectStablePageLayout(page);
            expectNoUnexpectedBrowserLogs({
              browserLogFailures,
              routePath: route.path,
              viewportLabel: viewport.label,
            });
          });
        }
      });
    }
  } finally {
    await database
      .delete(eventRegistrations)
      .where(eq(eventRegistrations.id, registrationId));
    await database
      .update(eventRegistrationOptions)
      .set({ checkedInSpots: scannerFixture.optionBefore.checkedInSpots })
      .where(
        eq(eventRegistrationOptions.id, scannerFixture.registrationOptionId),
      );
  }
});
