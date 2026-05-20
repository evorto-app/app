import { and, eq } from 'drizzle-orm';
import type { Page } from '@playwright/test';

import {
  emptyStateFile,
  userStateFile,
  usersToAuthenticate,
} from '../../../helpers/user-data';
import * as schema from '../../../src/db/schema';
import { expect, test } from '../../support/fixtures/parallel-test';

const regularUser = usersToAuthenticate.find((user) => user.roles === 'user');
const noRoleUser = usersToAuthenticate.find(
  (user) => user.stateFile === emptyStateFile,
);

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
      const targetOption =
        await database.query.eventRegistrationOptions.findFirst({
          where: { id: targetOptionId, tenantId: tenant.id },
        });
      if (!targetOption) {
        throw new Error('Expected seeded freeOpen registration option');
      }

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
          confirmedSpots: targetOption.spots,
          reservedSpots: 0,
          waitlistSpots: 0,
        })
        .where(eq(schema.eventRegistrationOptions.id, targetOptionId));

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

      const waitlistRegistration =
        await database.query.eventRegistrations.findFirst({
          where: {
            eventId: targetEventId,
            registrationOptionId: targetOptionId,
            status: 'WAITLIST',
            tenantId: tenant.id,
            userId: regularUser.id,
          },
        });
      expect(waitlistRegistration).toBeTruthy();
    });
  });

  test.describe('user without eligible roles', () => {
    test.use({ storageState: noRoleUser?.stateFile ?? emptyStateFile });

    test('keeps a direct event link visible with explicit ineligible copy', async ({
      page,
      seeded,
    }) => {
      if (!noRoleUser) {
        throw new Error('Expected no-role user fixture');
      }

      const targetEventId = seeded.scenario.events.freeOpen.eventId;
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
    });
  });
});
