import { and, eq } from 'drizzle-orm';
import type { Page } from '@playwright/test';

import { userStateFile, usersToAuthenticate } from '../../../helpers/user-data';
import * as schema from '../../../src/db/schema';
import { expect, test } from '../../support/fixtures/parallel-test';
import { seedRequiredRegistrationQuestion } from '../../support/utils/seed-registration-addons';
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
      const originalRegistrations = await database
        .select()
        .from(schema.eventRegistrations)
        .where(
          and(
            eq(schema.eventRegistrations.eventId, targetEventId),
            eq(schema.eventRegistrations.tenantId, tenant.id),
            eq(schema.eventRegistrations.userId, regularUser.id),
          ),
        );

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

        await page.goto(`/events/${targetEventId}`);
        await expect(page).toHaveURL(`/events/${targetEventId}`);
        await waitForRegistrationStatus(page);

        await expect(page.getByText('Registration is closed')).toBeVisible();
        await expect(
          page.getByRole('button', { name: /^Register$/ }),
        ).toHaveCount(0);
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
        if (originalRegistrations.length) {
          await database
            .insert(schema.eventRegistrations)
            .values(originalRegistrations);
        }
      }
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
      const originalRegistrations = await database
        .select()
        .from(schema.eventRegistrations)
        .where(
          and(
            eq(schema.eventRegistrations.eventId, targetEventId),
            eq(schema.eventRegistrations.tenantId, tenant.id),
            eq(schema.eventRegistrations.userId, regularUser.id),
          ),
        );
      const serverEventWindow = futureServerEventWindow();
      const registrationQuestion = await seedRequiredRegistrationQuestion({
        database,
        eventId: targetEventId,
        registrationOptionId: targetOptionId,
        title: 'Anything organizers should know?',
      });

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
            checkedInSpots: 0,
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
        await expect(page.getByLabel(registrationQuestion.title)).toBeVisible();
        await expect(waitlistButton).toBeDisabled();
        await page
          .getByLabel(registrationQuestion.title)
          .fill('Please tell me if a spot opens.');
        await expect(waitlistButton).toBeEnabled();
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
        const questionAnswers =
          await database.query.eventRegistrationQuestionAnswers.findMany({
            where: {
              registrationId: waitlistRegistration.id,
            },
          });
        expect(questionAnswers).toEqual([
          expect.objectContaining({
            answer: 'Please tell me if a spot opens.',
            questionId: registrationQuestion.questionId,
          }),
        ]);
        await page.getByRole('button', { name: 'Leave waitlist' }).click();
        await expect(page.getByText('This option is full.')).toBeVisible();
        await expect(
          page.getByRole('button', { name: 'Join waitlist' }),
        ).toBeVisible();

        const [cancelledWaitlistRegistration] = await database
          .select()
          .from(schema.eventRegistrations)
          .where(
            and(
              eq(schema.eventRegistrations.id, waitlistRegistration.id),
              eq(schema.eventRegistrations.status, 'CANCELLED'),
              eq(schema.eventRegistrations.tenantId, tenant.id),
            ),
          )
          .limit(1);
        if (!cancelledWaitlistRegistration) {
          throw new Error(
            'Expected leaving waitlist to cancel the registration',
          );
        }

        const optionAfterLeaving =
          await database.query.eventRegistrationOptions.findFirst({
            where: { eventId: targetEventId, id: targetOptionId },
          });
        if (!optionAfterLeaving) {
          throw new Error(
            'Expected seeded freeOpen option after leaving waitlist',
          );
        }
        expect(optionAfterLeaving.waitlistSpots).toBe(0);
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
        if (originalRegistrations.length) {
          await database
            .insert(schema.eventRegistrations)
            .values(originalRegistrations);
        }
        await database
          .delete(schema.eventRegistrationQuestions)
          .where(
            eq(
              schema.eventRegistrationQuestions.id,
              registrationQuestion.questionId,
            ),
          );
        await database
          .update(schema.eventRegistrationOptions)
          .set({
            checkedInSpots: targetOption.checkedInSpots,
            closeRegistrationTime: targetOption.closeRegistrationTime,
            confirmedSpots: targetOption.confirmedSpots,
            openRegistrationTime: targetOption.openRegistrationTime,
            registrationMode: targetOption.registrationMode,
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
          where: { eventId: targetEventId, id: targetOptionId },
        });
      if (!targetOption) {
        throw new Error('Expected seeded freeOpen registration option');
      }
      const originalRegistrations = await database
        .select()
        .from(schema.eventRegistrations)
        .where(
          and(
            eq(schema.eventRegistrations.eventId, targetEventId),
            eq(schema.eventRegistrations.tenantId, tenant.id),
            eq(schema.eventRegistrations.userId, regularUser.id),
          ),
        );

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
          .delete(schema.eventRegistrations)
          .where(
            and(
              eq(schema.eventRegistrations.eventId, targetEventId),
              eq(schema.eventRegistrations.tenantId, tenant.id),
              eq(schema.eventRegistrations.userId, regularUser.id),
            ),
          );
        if (originalRegistrations.length) {
          await database
            .insert(schema.eventRegistrations)
            .values(originalRegistrations);
        }
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
    test('keeps a direct event link visible with explicit ineligible copy', async ({
      database,
      page,
      roles,
      seeded,
      tenant,
    }) => {
      if (!regularUser) {
        throw new Error('Expected regular user fixture');
      }

      const organizerOnlyRole = roles.find(
        (role) => role.defaultOrganizerRole && !role.defaultUserRole,
      );
      if (!organizerOnlyRole) {
        throw new Error('Expected seeded organizer-only role');
      }

      const targetEventId = seeded.scenario.events.freeOpen.eventId;
      const targetOptionId = seeded.scenario.events.freeOpen.optionId;
      const targetOption =
        await database.query.eventRegistrationOptions.findFirst({
          where: { eventId: targetEventId, id: targetOptionId },
        });
      if (!targetOption) {
        throw new Error('Expected seeded freeOpen registration option');
      }
      const originalRegistrations = await database
        .select()
        .from(schema.eventRegistrations)
        .where(
          and(
            eq(schema.eventRegistrations.eventId, targetEventId),
            eq(schema.eventRegistrations.tenantId, tenant.id),
            eq(schema.eventRegistrations.userId, regularUser.id),
          ),
        );

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
          .set({ roleIds: [organizerOnlyRole.id] })
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
          .delete(schema.eventRegistrations)
          .where(
            and(
              eq(schema.eventRegistrations.eventId, targetEventId),
              eq(schema.eventRegistrations.tenantId, tenant.id),
              eq(schema.eventRegistrations.userId, regularUser.id),
            ),
          );
        if (originalRegistrations.length) {
          await database
            .insert(schema.eventRegistrations)
            .values(originalRegistrations);
        }
        await database
          .update(schema.eventRegistrationOptions)
          .set({ roleIds: targetOption.roleIds })
          .where(eq(schema.eventRegistrationOptions.id, targetOptionId));
      }
    });
  });
});
