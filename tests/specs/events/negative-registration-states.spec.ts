import { and, eq } from 'drizzle-orm';
import type { Page } from '@playwright/test';

import { userStateFile, usersToAuthenticate } from '../../../helpers/user-data';
import * as schema from '../../../src/db/schema';
import { expect, test } from '../../support/fixtures/parallel-test';
import { futureServerEventWindow } from '../../support/utils/server-test-clock';

const regularUser = usersToAuthenticate.find((user) => user.roles === 'user');

const waitForRegistrationStatus = async (page: Pick<Page, 'getByText'>) => {
  await page
    .getByText('Loading registration status')
    .first()
    .waitFor({ state: 'detached' });
};

test.describe('Negative registration states', () => {
  test.describe('regular user', () => {
    test.use({ storageState: userStateFile });

    test('shows a closed registration window without a registration action', async ({
      database,
      page,
      seeded,
      tenant,
    }) => {
      if (!regularUser) {
        throw new Error('Expected regular user fixture');
      }

      const targetEventId = seeded.scenario.events.closedReg.eventId;
      await database
        .delete(schema.eventRegistrations)
        .where(
          and(
            eq(schema.eventRegistrations.eventId, targetEventId),
            eq(schema.eventRegistrations.tenantId, tenant.id),
            eq(schema.eventRegistrations.userId, regularUser.id),
          ),
        );

      await page.goto(`/events/${targetEventId}`);
      await expect(page).toHaveURL(`/events/${targetEventId}`);
      await waitForRegistrationStatus(page);

      await expect(page.getByText('Registration is closed')).toBeVisible();
      await expect(
        page.getByRole('button', { name: /^Register$/ }),
      ).toHaveCount(0);
    });

    test('offers a distinct waitlist action when a participant option is full', async ({
      database,
      page,
      seeded,
      tenant,
    }) => {
      if (!regularUser) {
        throw new Error('Expected regular user fixture');
      }

      const targetEventId = seeded.scenario.events.freeOpen.eventId;
      const targetOptionId = seeded.scenario.events.freeOpen.optionId;
      const [targetOption] = await database
        .select()
        .from(schema.eventRegistrationOptions)
        .where(
          and(
            eq(schema.eventRegistrationOptions.id, targetOptionId),
            eq(schema.eventRegistrationOptions.eventId, targetEventId),
          ),
        )
        .limit(1);
      if (!targetOption) {
        throw new Error('Expected seeded freeOpen registration option');
      }
      const targetEvent = await database.query.eventInstances.findFirst({
        where: { id: targetEventId, tenantId: tenant.id },
      });
      if (!targetEvent) {
        throw new Error('Expected seeded freeOpen event');
      }
      const serverEventWindow = futureServerEventWindow();

      try {
        await database
          .delete(schema.eventRegistrations)
          .where(
            and(
              eq(schema.eventRegistrations.eventId, targetEventId),
              eq(schema.eventRegistrations.tenantId, tenant.id),
              eq(schema.eventRegistrations.userId, regularUser.id),
            ),
          );
        await database
          .update(schema.eventRegistrationOptions)
          .set({
            closeRegistrationTime: serverEventWindow.closeRegistrationTime,
            confirmedSpots: targetOption.spots,
            openRegistrationTime: serverEventWindow.openRegistrationTime,
            reservedSpots: 0,
            waitlistSpots: 0,
          })
          .where(eq(schema.eventRegistrationOptions.id, targetOptionId));
        await database
          .update(schema.eventInstances)
          .set({
            end: serverEventWindow.end,
            start: serverEventWindow.start,
          })
          .where(eq(schema.eventInstances.id, targetEventId));

        await page.goto(`/events/${targetEventId}`);
        await waitForRegistrationStatus(page);

        await expect(page.getByText('This option is full.')).toBeVisible();
        const waitlistButton = page.getByRole('button', {
          name: 'Join waitlist',
        });
        await expect(waitlistButton).toBeVisible();
        await expect(
          page.getByRole('button', { name: /^Register$/ }),
        ).toHaveCount(0);

        await waitlistButton.click();
        await expect(
          page.getByText('You are currently on the waitlist'),
        ).toBeVisible();
        await expect(
          page.getByRole('button', { name: 'Leave waitlist' }),
        ).toBeVisible();

        const [waitlistRegistration] = await database
          .select()
          .from(schema.eventRegistrations)
          .where(
            and(
              eq(schema.eventRegistrations.eventId, targetEventId),
              eq(
                schema.eventRegistrations.registrationOptionId,
                targetOptionId,
              ),
              eq(schema.eventRegistrations.status, 'WAITLIST'),
              eq(schema.eventRegistrations.tenantId, tenant.id),
              eq(schema.eventRegistrations.userId, regularUser.id),
            ),
          )
          .limit(1);
        if (!waitlistRegistration) {
          throw new Error(
            'Expected waitlist registration after joining waitlist',
          );
        }
        expect(waitlistRegistration).toEqual(
          expect.objectContaining({
            registrationOptionId: targetOptionId,
            status: 'WAITLIST',
            tenantId: tenant.id,
            userId: regularUser.id,
          }),
        );
      } finally {
        await database
          .delete(schema.eventRegistrations)
          .where(
            and(
              eq(schema.eventRegistrations.eventId, targetEventId),
              eq(schema.eventRegistrations.tenantId, tenant.id),
              eq(schema.eventRegistrations.userId, regularUser.id),
            ),
          );
        await database
          .update(schema.eventRegistrationOptions)
          .set({
            closeRegistrationTime: targetOption.closeRegistrationTime,
            confirmedSpots: targetOption.confirmedSpots,
            openRegistrationTime: targetOption.openRegistrationTime,
            reservedSpots: targetOption.reservedSpots,
            waitlistSpots: targetOption.waitlistSpots,
          })
          .where(eq(schema.eventRegistrationOptions.id, targetOptionId));
        await database
          .update(schema.eventInstances)
          .set({
            end: targetEvent.end,
            start: targetEvent.start,
          })
          .where(eq(schema.eventInstances.id, targetEventId));
      }
    });

    test('does not expose a waitlist action for full unsupported stored modes', async ({
      database,
      page,
      seeded,
      tenant,
    }) => {
      if (!regularUser) {
        throw new Error('Expected regular user fixture');
      }

      const targetEventId = seeded.scenario.events.freeOpen.eventId;
      const targetOptionId = seeded.scenario.events.freeOpen.optionId;
      const targetOption =
        await database.query.eventRegistrationOptions.findFirst({
          where: { id: targetOptionId, tenantId: tenant.id },
        });
      if (!targetOption) {
        throw new Error('Expected seeded freeOpen registration option');
      }

      try {
        await database
          .delete(schema.eventRegistrations)
          .where(
            and(
              eq(schema.eventRegistrations.eventId, targetEventId),
              eq(schema.eventRegistrations.tenantId, tenant.id),
              eq(schema.eventRegistrations.userId, regularUser.id),
            ),
          );
        for (const registrationMode of ['random', 'application'] as const) {
          await database
            .update(schema.eventRegistrationOptions)
            .set({
              confirmedSpots: targetOption.spots,
              registrationMode,
              reservedSpots: 0,
              waitlistSpots: 0,
            })
            .where(eq(schema.eventRegistrationOptions.id, targetOptionId));

          await page.goto(`/events/${targetEventId}`);
          await waitForRegistrationStatus(page);

          const optionCard = page
            .locator('app-event-registration-option')
            .filter({ hasText: targetOption.title });
          await expect(
            optionCard.getByText('This option is full.'),
          ).toBeVisible();
          await expect(
            optionCard.getByRole('button', { name: 'Join waitlist' }),
          ).toHaveCount(0);
          await expect(
            optionCard.getByRole('button', { name: /^Register$/ }),
          ).toHaveCount(0);
        }
      } finally {
        await database
          .update(schema.eventRegistrationOptions)
          .set({
            confirmedSpots: targetOption.confirmedSpots,
            registrationMode: targetOption.registrationMode,
            reservedSpots: targetOption.reservedSpots,
            waitlistSpots: targetOption.waitlistSpots,
          })
          .where(eq(schema.eventRegistrationOptions.id, targetOptionId));
      }
    });
  });

  test.describe('user without eligible roles', () => {
    test.use({ storageState: userStateFile });

    test('keeps a direct event link visible with explicit ineligible copy', async ({
      database,
      page,
      roles,
      seeded,
    }) => {
      const targetEventId = seeded.scenario.events.freeOpen.eventId;
      const targetOptionId = seeded.scenario.events.freeOpen.optionId;
      const targetOption =
        await database.query.eventRegistrationOptions.findFirst({
          where: { eventId: targetEventId, id: targetOptionId },
        });
      if (!targetOption) {
        throw new Error('Expected seeded freeOpen registration option');
      }
      const organizerRoleIds = roles
        .filter((role) => role.defaultOrganizerRole)
        .map((role) => role.id);

      try {
        await database
          .update(schema.eventRegistrationOptions)
          .set({ roleIds: organizerRoleIds })
          .where(eq(schema.eventRegistrationOptions.id, targetOptionId));

        await page.goto(`/events/${targetEventId}`);
        await expect(page).toHaveURL(`/events/${targetEventId}`);
        await waitForRegistrationStatus(page);

        await expect(
          page.getByRole('heading', { name: 'Registration unavailable' }),
        ).toBeVisible();
        await expect(
          page.getByText(
            'This event is visible from the direct link, but your account is not eligible for the available registration options.',
          ),
        ).toBeVisible();
        await expect(
          page.getByRole('button', { name: /^Register$/ }),
        ).toHaveCount(0);
      } finally {
        await database
          .update(schema.eventRegistrationOptions)
          .set({ roleIds: targetOption.roleIds })
          .where(eq(schema.eventRegistrationOptions.id, targetOptionId));
      }
    });
  });
});
