import { eq } from 'drizzle-orm';

import { adminStateFile } from '../../../helpers/user-data';
import * as schema from '../../../src/db/schema';
import { expect, test } from '../../support/fixtures/parallel-test';
import { seedFreeAddonRegistrationEvent } from '../../support/utils/seed-registration-addons';
import { futureServerEventWindow } from '../../support/utils/server-test-clock';

for (const javaScriptEnabled of [true, false]) {
  test.describe(
    javaScriptEnabled ? 'Hydrated layouts' : 'Server-rendered layouts',
    () => {
      test.use({ javaScriptEnabled, storageState: adminStateFile });

      test('actions and forms fit at intermediate list/detail widths', async ({
        database,
        page,
        registerDatabaseCleanup,
        seeded,
        tenant,
      }) => {
        const event = await seedFreeAddonRegistrationEvent({
          database,
          registerDatabaseCleanup,
          sourceEventId: seeded.scenario.events.freeOpen.eventId,
          sourceOptionId: seeded.scenario.events.freeOpen.optionId,
          tenantId: tenant.id,
          window: futureServerEventWindow(),
        });
        await database
          .update(schema.eventInstances)
          .set({
            status: 'PENDING_REVIEW',
            reviewedAt: null,
            reviewedBy: null,
            statusComment: null,
          })
          .where(eq(schema.eventInstances.id, event.eventId));
        const template = await database.query.eventTemplates.findFirst({
          where: { tenantId: tenant.id },
        });
        if (!template) throw new Error('Expected a template');

        for (const width of [390, 848, 1024, 1280, 1440]) {
          await page.setViewportSize({ width, height: 900 });
          for (const route of [
            `/events/${event.eventId}`,
            `/templates/${template.id}/create-event`,
            '/profile',
            '/admin/settings/legal',
          ]) {
            await page.goto(route);
            if (route.startsWith('/events/')) {
              await expect(
                page.getByRole('button', {
                  name: 'Return to draft',
                  exact: true,
                }),
              ).toBeVisible();
              await expect(
                page.getByRole('button', { name: 'Approve', exact: true }),
              ).toBeVisible();
              const header = page.locator('header');
              const management = header.getByRole('navigation', {
                name: 'Event management',
              });
              await expect(management).toBeVisible();
              const identityBox = await header
                .locator(':scope > div')
                .boundingBox();
              const managementBox = await management.boundingBox();
              if (!identityBox || !managementBox)
                throw new Error(
                  'Expected event identity and management controls',
                );
              if (width >= 1440) {
                expect(managementBox.x).toBeGreaterThanOrEqual(
                  identityBox.x + identityBox.width - 1,
                );
              } else {
                expect(managementBox.y).toBeGreaterThanOrEqual(
                  identityBox.y + identityBox.height - 1,
                );
              }
            }
            await expect
              .poll(
                () =>
                  page.evaluate(() => {
                    const wrappedLabels = [
                      ...document.querySelectorAll('.mdc-button__label'),
                    ]
                      .filter((element) => {
                        if (!element.getBoundingClientRect().width)
                          return false;
                        const range = document.createRange();
                        range.selectNodeContents(element);
                        return (
                          new Set(
                            [...range.getClientRects()]
                              .filter((rect) => rect.width > 0)
                              .map((rect) => Math.round(rect.top)),
                          ).size > 1
                        );
                      })
                      .map((element) => element.textContent?.trim());
                    const overflowingPanes = [
                      ...document.querySelectorAll(
                        'app-two-column-layout [role="region"]',
                      ),
                    ]
                      .filter(
                        (element) =>
                          element.clientWidth > 0 &&
                          element.scrollWidth > element.clientWidth + 1,
                      )
                      .map((element) => element.getAttribute('aria-label'));
                    return {
                      overflowingPanes,
                      overflow:
                        document.documentElement.scrollWidth >
                        window.innerWidth,
                      wrappedLabels,
                    };
                  }),
                `${route} at ${width}px`,
              )
              .toEqual({
                overflow: false,
                overflowingPanes: [],
                wrappedLabels: [],
              });
          }
        }
      });
    },
  );
}
