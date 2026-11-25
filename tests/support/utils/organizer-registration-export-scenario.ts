import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { and, eq } from 'drizzle-orm';

import type { SeedTenantResult } from '../../../helpers/seed-tenant';

import { usersToAuthenticate } from '../../../helpers/user-data';
import { createId } from '../../../src/db/create-id';
import { relations } from '../../../src/db/relations';
import * as schema from '../../../src/db/schema';
import {
  futureServerEventWindow,
  latestServerOrWallNow,
} from './server-test-clock';

type TestDatabase = NodePgDatabase<typeof relations>;

export interface OrganizerRegistrationExportPerson {
  communicationEmail: string;
  firstName: string;
  id: string;
  lastName: string;
}

export interface OrganizerRegistrationExportScenario {
  cancelled: OrganizerRegistrationExportPerson;
  checkedIn: OrganizerRegistrationExportPerson;
  checkInTime: Date;
  cleanup: () => Promise<void>;
  event: { id: string; title: string };
  formulaAnswer: string;
  optionTitle: string;
  questionTitle: string;
  questionAnswer: OrganizerRegistrationExportPerson;
  tenant: SeedTenantResult['tenant'] & { timezone: string };
}

const requireCanonicalUser = (
  role: 'none' | 'organizer' | 'user',
): (typeof usersToAuthenticate)[number] => {
  const user = usersToAuthenticate.find(
    (candidate) => candidate.roles === role,
  );
  if (!user) {
    throw new Error(`Expected canonical ${role} test user`);
  }

  return user;
};

export const seedOrganizerRegistrationExportScenario = async ({
  database,
  seeded,
}: {
  database: TestDatabase;
  seeded: SeedTenantResult;
}): Promise<OrganizerRegistrationExportScenario> => {
  const adminFixture = usersToAuthenticate.find(
    (candidate) => candidate.roles === 'admin',
  );
  const people = await Promise.all(
    [
      requireCanonicalUser('organizer'),
      requireCanonicalUser('user'),
      requireCanonicalUser('none'),
    ].map((fixture) =>
      database.query.users.findFirst({
        columns: {
          communicationEmail: true,
          firstName: true,
          id: true,
          lastName: true,
        },
        where: { id: fixture.id },
      }),
    ),
  );
  const [checkedIn, questionAnswer, cancelled] = people;
  const sourceEvent = await database.query.eventInstances.findFirst({
    where: {
      id: seeded.scenario.events.freeOpen.eventId,
      tenantId: seeded.tenant.id,
    },
  });
  const tenant = await database.query.tenants.findFirst({
    columns: { timezone: true },
    where: { id: seeded.tenant.id },
  });
  if (
    !adminFixture ||
    !checkedIn ||
    !questionAnswer ||
    !cancelled ||
    !sourceEvent ||
    !tenant
  ) {
    throw new Error('Expected seeded registration export source records');
  }

  const eventId = createId();
  const optionId = createId();
  const questionId = createId();
  const title = 'Registration export workshop';
  const optionTitle = 'Export guest';
  const questionTitle = 'Dietary needs';
  const formulaAnswer = '=SUM(A1)';
  const eventWindow = futureServerEventWindow();
  const checkInTime = new Date(Date.UTC(2030, 2, 15, 10, 30, 0));
  let eventCreated = false;

  const cleanup = async (): Promise<void> => {
    if (!eventCreated) {
      return;
    }

    await database
      .delete(schema.eventRegistrationQuestionAnswers)
      .where(eq(schema.eventRegistrationQuestionAnswers.eventId, eventId));
    await database
      .delete(schema.eventRegistrations)
      .where(
        and(
          eq(schema.eventRegistrations.eventId, eventId),
          eq(schema.eventRegistrations.tenantId, seeded.tenant.id),
        ),
      );
    await database
      .delete(schema.eventRegistrationQuestions)
      .where(eq(schema.eventRegistrationQuestions.eventId, eventId));
    await database
      .delete(schema.eventRegistrationOptions)
      .where(eq(schema.eventRegistrationOptions.eventId, eventId));
    await database
      .delete(schema.eventInstances)
      .where(
        and(
          eq(schema.eventInstances.id, eventId),
          eq(schema.eventInstances.tenantId, seeded.tenant.id),
        ),
      );
    eventCreated = false;
  };

  try {
    await database.insert(schema.eventInstances).values({
      creatorId: adminFixture.id,
      description: 'Disposable event for the organizer registration export.',
      end: eventWindow.end,
      icon: sourceEvent.icon,
      id: eventId,
      location: sourceEvent.location,
      reviewedAt: latestServerOrWallNow(),
      reviewedBy: adminFixture.id,
      start: eventWindow.start,
      status: 'APPROVED',
      templateId: sourceEvent.templateId,
      tenantId: seeded.tenant.id,
      title,
    });
    eventCreated = true;
    await database.insert(schema.eventRegistrationOptions).values({
      cancellationDeadlineHoursBeforeStart: 0,
      closeRegistrationTime: eventWindow.closeRegistrationTime,
      description: 'Guests of the export workshop.',
      eventId,
      id: optionId,
      isPaid: false,
      openRegistrationTime: eventWindow.openRegistrationTime,
      organizingRegistration: false,
      price: 0,
      registrationMode: 'fcfs',
      roleIds: seeded.roles
        .filter((role) => role.defaultUserRole)
        .map((role) => role.id),
      spots: 10,
      title: optionTitle,
    });
    await database.insert(schema.eventRegistrationQuestions).values({
      eventId,
      id: questionId,
      registrationOptionId: optionId,
      required: false,
      sortOrder: 0,
      title: questionTitle,
    });

    const registrationBase = {
      basePriceAtRegistration: 0,
      discountAmount: 0,
      eventId,
      registrationOptionId: optionId,
      tenantId: seeded.tenant.id,
    };
    const registrations = [
      {
        ...registrationBase,
        checkInTime,
        id: createId(),
        status: 'CONFIRMED' as const,
        userId: checkedIn.id,
      },
      {
        ...registrationBase,
        id: createId(),
        status: 'CONFIRMED' as const,
        userId: questionAnswer.id,
      },
      {
        ...registrationBase,
        id: createId(),
        status: 'CANCELLED' as const,
        userId: cancelled.id,
      },
    ];
    await database.insert(schema.eventRegistrations).values(registrations);
    await database.insert(schema.eventRegistrationQuestionAnswers).values({
      answer: formulaAnswer,
      eventId,
      questionId,
      registrationId: registrations[1].id,
      registrationOptionId: optionId,
      tenantId: seeded.tenant.id,
    });
  } catch (error) {
    await cleanup();
    throw error;
  }

  return {
    cancelled,
    checkedIn,
    checkInTime,
    cleanup,
    event: { id: eventId, title },
    formulaAnswer,
    optionTitle,
    questionAnswer,
    questionTitle,
    tenant: { ...seeded.tenant, timezone: tenant.timezone },
  };
};
