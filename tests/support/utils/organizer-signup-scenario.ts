import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { and, eq, inArray } from 'drizzle-orm';

import type { SeedTenantResult } from '../../../helpers/seed-tenant';

import { usersToAuthenticate } from '../../../helpers/user-data';
import { createId } from '../../../src/db/create-id';
import { relations } from '../../../src/db/relations';
import * as schema from '../../../src/db/schema';
import { futureServerEventWindow } from './server-test-clock';

type TestDatabase = NodePgDatabase<typeof relations>;

export interface OrganizerSignupScenarioOption {
  id: string;
  organizingRegistration: boolean;
  registrationMode: 'application' | 'fcfs';
  roleIds: readonly string[];
  spots: number;
  title: string;
}

export interface OrganizerSignupScenario {
  applicant: {
    communicationEmail: null | string;
    email: string;
    firstName: string;
    id: string;
    lastName: string;
  };
  cleanup: () => Promise<void>;
  event: {
    id: string;
    simpleModeEnabled: boolean;
    title: string;
  };
  hiddenOrganizerOption?: OrganizerSignupScenarioOption;
  organizerOption: OrganizerSignupScenarioOption;
  participantOption: OrganizerSignupScenarioOption;
  reviewer: {
    email: string;
    firstName: string;
    id: string;
    lastName: string;
  };
  tenant: SeedTenantResult['tenant'];
}

const requireCanonicalUser = (
  role: 'admin' | 'organizer',
): (typeof usersToAuthenticate)[number] => {
  const user = usersToAuthenticate.find(
    (candidate) => candidate.roles === role,
  );
  if (!user) {
    throw new Error(`Expected canonical ${role} test user`);
  }

  return user;
};

const registrationOutboxKeys = (
  tenantId: string,
  registrationId: string,
): readonly string[] => [
  `registration-cancelled/${tenantId}/${registrationId}`,
  `registration-confirmed/${tenantId}/${registrationId}`,
];

export const seedOrganizerSignupScenario = async ({
  database,
  mode,
  seeded,
}: {
  database: TestDatabase;
  mode: 'advanced' | 'simple';
  seeded: SeedTenantResult;
}): Promise<OrganizerSignupScenario> => {
  const applicantFixture = requireCanonicalUser('organizer');
  const reviewerFixture = requireCanonicalUser('admin');
  const sourceEventId = seeded.scenario.events.freeOpen.eventId;
  const sourceEvent = await database.query.eventInstances.findFirst({
    where: {
      id: sourceEventId,
      tenantId: seeded.tenant.id,
    },
  });
  const applicant = await database.query.users.findFirst({
    columns: {
      communicationEmail: true,
      email: true,
      firstName: true,
      id: true,
      lastName: true,
    },
    where: { id: applicantFixture.id },
  });
  const reviewer = await database.query.users.findFirst({
    columns: {
      email: true,
      firstName: true,
      id: true,
      lastName: true,
    },
    where: { id: reviewerFixture.id },
  });
  const defaultUserRoleIds = seeded.roles
    .filter((role) => role.defaultUserRole)
    .map((role) => role.id);
  const sectionMemberRole = seeded.roles.find(
    (role) => role.name === 'Section member' && role.defaultOrganizerRole,
  );
  const trialMemberRole = seeded.roles.find(
    (role) => role.name === 'Trial member' && role.defaultOrganizerRole,
  );
  const helperRole = seeded.roles.find((role) => role.name === 'Helper');

  if (!sourceEvent || !applicant || !reviewer) {
    throw new Error(`Expected seeded ${mode} organizer signup source records`);
  }
  if (
    defaultUserRoleIds.length === 0 ||
    !sectionMemberRole ||
    !trialMemberRole ||
    !helperRole
  ) {
    throw new Error(
      'Expected default participant, Section member, Trial member, and Helper roles',
    );
  }

  const eventId = createId();
  const participantOption: OrganizerSignupScenarioOption = {
    id: createId(),
    organizingRegistration: false,
    registrationMode: 'fcfs',
    roleIds: defaultUserRoleIds,
    spots: 4,
    title: mode === 'simple' ? 'Participant registration' : 'Attendee',
  };
  const organizerOption: OrganizerSignupScenarioOption = {
    id: createId(),
    organizingRegistration: true,
    registrationMode: mode === 'simple' ? 'fcfs' : 'application',
    roleIds:
      mode === 'simple'
        ? [sectionMemberRole.id, trialMemberRole.id]
        : [trialMemberRole.id],
    spots: 1,
    title:
      mode === 'simple'
        ? 'Organizer/helper registration'
        : 'Lead organizer application',
  };
  const hiddenOrganizerOption: OrganizerSignupScenarioOption | undefined =
    mode === 'advanced'
      ? {
          id: createId(),
          organizingRegistration: true,
          registrationMode: 'application',
          roleIds: [helperRole.id],
          spots: 2,
          title: 'Event helper application',
        }
      : undefined;
  const eventWindow = futureServerEventWindow();
  const title =
    mode === 'simple'
      ? 'Organizer/helper signup journey'
      : 'Advanced organizer application journey';
  let eventCreated = false;

  const cleanup = async (): Promise<void> => {
    if (!eventCreated) {
      return;
    }

    const registrations = await database.query.eventRegistrations.findMany({
      columns: { id: true },
      where: {
        eventId,
        tenantId: seeded.tenant.id,
      },
    });
    const registrationIds = registrations.map(
      (registration) => registration.id,
    );

    if (registrationIds.length > 0) {
      const exactOutboxKeys = registrationIds.flatMap((registrationId) =>
        registrationOutboxKeys(seeded.tenant.id, registrationId),
      );
      const relatedOutboxRows = await database.query.emailOutbox.findMany({
        columns: {
          id: true,
          idempotencyKey: true,
        },
        where: {
          tenantId: seeded.tenant.id,
        },
      });
      const relatedOutboxIds = relatedOutboxRows
        .filter(
          (row) =>
            exactOutboxKeys.includes(row.idempotencyKey) ||
            registrationIds.some((registrationId) =>
              row.idempotencyKey.includes(`/${registrationId}/`),
            ),
        )
        .map((row) => row.id);

      if (relatedOutboxIds.length > 0) {
        await database
          .delete(schema.emailOutbox)
          .where(inArray(schema.emailOutbox.id, relatedOutboxIds));
      }
    }

    await database
      .delete(schema.transactions)
      .where(
        and(
          eq(schema.transactions.eventId, eventId),
          eq(schema.transactions.tenantId, seeded.tenant.id),
        ),
      );
    await database
      .delete(schema.eventRegistrations)
      .where(
        and(
          eq(schema.eventRegistrations.eventId, eventId),
          eq(schema.eventRegistrations.tenantId, seeded.tenant.id),
        ),
      );
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
      creatorId: reviewer.id,
      description:
        mode === 'simple'
          ? 'Choose whether you are attending or helping run this event.'
          : 'Choose the advanced organizer category that matches your tenant role.',
      end: eventWindow.end,
      icon: sourceEvent.icon,
      id: eventId,
      location: sourceEvent.location,
      simpleModeEnabled: mode === 'simple',
      start: eventWindow.start,
      status: 'APPROVED',
      templateId: sourceEvent.templateId,
      tenantId: seeded.tenant.id,
      title,
      unlisted: false,
    });
    eventCreated = true;

    await database.insert(schema.eventRegistrationOptions).values(
      [participantOption, organizerOption, hiddenOrganizerOption]
        .filter(
          (option): option is OrganizerSignupScenarioOption =>
            option !== undefined,
        )
        .map((option) => ({
          cancellationDeadlineHoursBeforeStart: 0,
          closeRegistrationTime: eventWindow.closeRegistrationTime,
          description: option.organizingRegistration
            ? 'Use this category only when you are helping run the event.'
            : 'Use this category when you are attending the event.',
          eventId,
          id: option.id,
          isPaid: false,
          openRegistrationTime: eventWindow.openRegistrationTime,
          organizingRegistration: option.organizingRegistration,
          price: 0,
          registeredDescription: option.organizingRegistration
            ? null
            : 'Your participant registration is confirmed.',
          registrationMode: option.registrationMode,
          roleIds: [...option.roleIds],
          spots: option.spots,
          title: option.title,
        })),
    );
  } catch (error) {
    await cleanup();
    throw error;
  }

  return {
    applicant,
    cleanup,
    event: {
      id: eventId,
      simpleModeEnabled: mode === 'simple',
      title,
    },
    ...(hiddenOrganizerOption && { hiddenOrganizerOption }),
    organizerOption,
    participantOption,
    reviewer,
    tenant: seeded.tenant,
  };
};
