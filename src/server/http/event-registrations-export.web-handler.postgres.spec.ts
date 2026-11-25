import { afterAll, beforeAll, describe, expect, it } from '@effect/vitest';
import { inArray } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { ConfigProvider, Effect, Layer } from 'effect';
import { Pool } from 'pg';

import { databaseLayer } from '../../db';
import { createId } from '../../db/create-id';
import { createNodePgPoolConfig } from '../../db/pg-connection-config';
import { relations } from '../../db/relations';
import {
  eventInstances,
  eventRegistrationOptions,
  eventRegistrationQuestionAnswers,
  eventRegistrationQuestions,
  eventRegistrations,
  eventTemplateCategories,
  eventTemplates,
  tenants,
  users,
} from '../../db/schema';
import { type Permission } from '../../shared/permissions/permissions';
import { Context as RequestContext } from '../../types/custom/context';
import { Tenant } from '../../types/custom/tenant';
import { User } from '../../types/custom/user';
import { handleEventRegistrationsExportWebRequest } from './event-registrations-export.web-handler';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for PostgreSQL integration tests');
}

type TestDatabase = NodePgDatabase<typeof relations>;

const tenantId = createId();
const otherTenantId = createId();
const categoryId = createId();
const otherCategoryId = createId();
const templateId = createId();
const otherTemplateId = createId();
const eventId = createId();
const otherEventId = createId();
const crewOptionId = createId();
const applicantsOptionId = createId();
const hikersOptionId = createId();
const otherOptionId = createId();
const taskQuestionId = createId();
const shirtQuestionId = createId();

const userId = Object.fromEntries(
  ['member', 'organizer', 'anna', 'bert', 'pia', 'wanda', 'carl', 'fred'].map(
    (name) => [name, createId()],
  ),
) as Record<string, string>;

const tenantRecord = new Tenant({
  cancellationDeadlineHoursBeforeStart: 120,
  currency: 'EUR' as const,
  defaultLocation: undefined,
  discountProviders: {
    esnCard: { config: {}, status: 'disabled' as const },
  },
  domain: `${tenantId}.registrations-export.example`,
  id: tenantId,
  maxActiveRegistrationsPerUser: 0,
  name: 'Registrations export',
  receiptSettings: { allowOther: false, receiptCountries: ['NL'] },
  refundFeesOnCancellation: true,
  stripeAccountId: null,
  theme: 'evorto' as const,
  timezone: 'Europe/Berlin',
  transferDeadlineHoursBeforeStart: 0,
});

const createContext = ({
  authenticated = true,
  permissions = [],
  user = 'member',
}: {
  authenticated?: boolean;
  permissions?: readonly Permission[];
  user?: string;
} = {}) =>
  new RequestContext({
    authentication: { isAuthenticated: authenticated },
    permissions,
    tenant: tenantRecord,
    user: authenticated
      ? new User({
          auth0Id: `auth0|${userId[user]}`,
          communicationEmail: `${user}@example.com`,
          email: `${user}@example.com`,
          firstName: user,
          homeTenantId: undefined,
          homeTenantName: undefined,
          iban: undefined,
          id: userId[user] ?? '',
          lastName: 'Viewer',
          paypalEmail: undefined,
          permissions,
          roleIds: [],
        })
      : undefined,
  });

const handlerLayer = databaseLayer.pipe(
  Layer.provide(
    ConfigProvider.layer(
      ConfigProvider.fromEnv({
        env: { DATABASE_TLS_REQUIRED: 'false', DATABASE_URL: databaseUrl },
      }),
    ),
  ),
);

const download = (targetEventId: string, context: RequestContext) =>
  Effect.runPromise(
    handleEventRegistrationsExportWebRequest(targetEventId, context).pipe(
      Effect.provide(handlerLayer),
    ),
  );

const readBody = async (response: Response) => {
  const bytes = new Uint8Array(await response.arrayBuffer());
  return {
    hasBom: bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf,
    text: new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes),
  };
};

describe('event registrations CSV export', () => {
  let database: TestDatabase;
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool(createNodePgPoolConfig({ databaseUrl }));
    database = drizzle({ client: pool, relations });

    await database.insert(tenants).values([
      {
        domain: tenantRecord.domain,
        id: tenantId,
        name: tenantRecord.name,
        timezone: 'Europe/Berlin',
      },
      {
        domain: `${otherTenantId}.registrations-export.example`,
        id: otherTenantId,
        name: 'Other export tenant',
      },
    ]);
    await database.insert(users).values(
      Object.entries(userId).map(([name, id]) => ({
        auth0Id: `auth0|${id}`,
        communicationEmail: `${name}.contact@example.com`,
        email: `${name}@example.com`,
        firstName: name,
        id,
        lastName: 'Viewer',
      })),
    );
    await database.insert(eventTemplateCategories).values([
      {
        icon: { iconColor: 0, iconName: 'circle' },
        id: categoryId,
        tenantId,
        title: 'Export',
      },
      {
        icon: { iconColor: 0, iconName: 'circle' },
        id: otherCategoryId,
        tenantId: otherTenantId,
        title: 'Other export',
      },
    ]);
    await database.insert(eventTemplates).values([
      {
        categoryId,
        description: 'Export fixture',
        icon: { iconColor: 0, iconName: 'circle' },
        id: templateId,
        tenantId,
        title: 'Export',
      },
      {
        categoryId: otherCategoryId,
        description: 'Other export fixture',
        icon: { iconColor: 0, iconName: 'circle' },
        id: otherTemplateId,
        tenantId: otherTenantId,
        title: 'Other export',
      },
    ]);
    const start = new Date('2100-01-02T10:00:00.000Z');
    const end = new Date('2100-01-02T12:00:00.000Z');
    const eventBase = {
      creatorId: userId['organizer'] ?? '',
      description: 'Export event',
      end,
      icon: { iconColor: 0, iconName: 'circle' },
      reviewedAt: new Date('2099-12-01T00:00:00.000Z'),
      reviewedBy: userId['organizer'],
      start,
      status: 'APPROVED' as const,
    };
    await database.insert(eventInstances).values([
      {
        ...eventBase,
        id: eventId,
        templateId,
        tenantId,
        title: 'Spring Hike',
      },
      {
        ...eventBase,
        id: otherEventId,
        templateId: otherTemplateId,
        tenantId: otherTenantId,
        title: 'Other tenant hike',
      },
    ]);
    const optionBase = {
      closeRegistrationTime: new Date('2100-01-01T23:00:00.000Z'),
      isPaid: false,
      openRegistrationTime: new Date('2099-12-01T00:00:00.000Z'),
      price: 0,
      roleIds: [],
      spots: 20,
    };
    await database.insert(eventRegistrationOptions).values([
      {
        ...optionBase,
        eventId,
        id: hikersOptionId,
        organizingRegistration: false,
        registrationMode: 'fcfs',
        title: 'Hikers',
      },
      {
        ...optionBase,
        eventId,
        id: applicantsOptionId,
        organizingRegistration: false,
        registrationMode: 'application',
        title: 'Applicants',
      },
      {
        ...optionBase,
        eventId,
        id: crewOptionId,
        organizingRegistration: true,
        registrationMode: 'fcfs',
        title: 'Crew',
      },
      {
        ...optionBase,
        eventId: otherEventId,
        id: otherOptionId,
        organizingRegistration: false,
        registrationMode: 'fcfs',
        title: 'Other hikers',
      },
    ]);
    await database.insert(eventRegistrationQuestions).values([
      {
        eventId,
        id: shirtQuestionId,
        registrationOptionId: hikersOptionId,
        title: 'Shirt size',
      },
      {
        eventId,
        id: taskQuestionId,
        registrationOptionId: crewOptionId,
        title: 'Task',
      },
    ]);
    const registrationBase = {
      basePriceAtRegistration: 0,
      discountAmount: 0,
      eventId,
      tenantId,
    };
    const registrationIds = Object.fromEntries(
      Object.keys(userId).map((name) => [name, createId()]),
    ) as Record<string, string>;
    await database.insert(eventRegistrations).values([
      {
        ...registrationBase,
        id: registrationIds['organizer'],
        registrationOptionId: crewOptionId,
        status: 'CONFIRMED',
        userId: userId['organizer'] ?? '',
      },
      {
        ...registrationBase,
        checkInTime: new Date('2026-09-15T10:05:00Z'),
        id: registrationIds['anna'],
        registrationOptionId: hikersOptionId,
        status: 'CONFIRMED',
        userId: userId['anna'] ?? '',
      },
      {
        ...registrationBase,
        id: registrationIds['bert'],
        registrationOptionId: hikersOptionId,
        status: 'CONFIRMED',
        userId: userId['bert'] ?? '',
      },
      {
        ...registrationBase,
        id: registrationIds['pia'],
        registrationOptionId: applicantsOptionId,
        status: 'PENDING',
        userId: userId['pia'] ?? '',
      },
      {
        ...registrationBase,
        id: registrationIds['wanda'],
        registrationOptionId: hikersOptionId,
        status: 'WAITLIST',
        userId: userId['wanda'] ?? '',
      },
      {
        ...registrationBase,
        id: registrationIds['carl'],
        registrationOptionId: hikersOptionId,
        status: 'CANCELLED',
        userId: userId['carl'] ?? '',
      },
      {
        ...registrationBase,
        id: registrationIds['fred'],
        registrationOptionId: hikersOptionId,
        status: 'PENDING',
        userId: userId['fred'] ?? '',
      },
    ]);
    await database.insert(eventRegistrationQuestionAnswers).values([
      {
        answer: '=1+1',
        eventId,
        questionId: shirtQuestionId,
        registrationId: registrationIds['anna'] ?? '',
        registrationOptionId: hikersOptionId,
        tenantId,
      },
      {
        answer: 'Gate, "north"',
        eventId,
        questionId: taskQuestionId,
        registrationId: registrationIds['organizer'] ?? '',
        registrationOptionId: crewOptionId,
        tenantId,
      },
    ]);
  });

  afterAll(async () => {
    const tenantIds = [tenantId, otherTenantId];
    const eventIds = [eventId, otherEventId];
    const failures: unknown[] = [];
    for (const cleanup of [
      () =>
        database
          .delete(eventRegistrationQuestionAnswers)
          .where(inArray(eventRegistrationQuestionAnswers.tenantId, tenantIds)),
      () =>
        database
          .delete(eventRegistrationQuestions)
          .where(inArray(eventRegistrationQuestions.eventId, eventIds)),
      () =>
        database
          .delete(eventRegistrations)
          .where(inArray(eventRegistrations.tenantId, tenantIds)),
      () =>
        database
          .delete(eventRegistrationOptions)
          .where(inArray(eventRegistrationOptions.eventId, eventIds)),
      () =>
        database
          .delete(eventInstances)
          .where(inArray(eventInstances.id, eventIds)),
      () =>
        database
          .delete(eventTemplates)
          .where(inArray(eventTemplates.id, [templateId, otherTemplateId])),
      () =>
        database
          .delete(eventTemplateCategories)
          .where(
            inArray(eventTemplateCategories.id, [categoryId, otherCategoryId]),
          ),
      () =>
        database.delete(users).where(inArray(users.id, Object.values(userId))),
      () => database.delete(tenants).where(inArray(tenants.id, tenantIds)),
      () => pool.end(),
    ]) {
      try {
        await cleanup();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, 'Export fixture cleanup failed', {
        cause: failures[0],
      });
    }
  });

  it('answers 401 when signed out', async () => {
    const response = await download(
      eventId,
      createContext({ authenticated: false }),
    );
    expect(response.status).toBe(401);
    expect(await response.text()).toBe('Sign in to download this export.');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('Content-Type')).toContain('text/plain');
  });

  it('answers 403 for a plain member', async () => {
    const response = await download(eventId, createContext());
    expect(response.status).toBe(403);
    expect(await response.text()).toBe('Organizer access required.');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('answers 404 for another tenant event even with events:organizeAll', async () => {
    const response = await download(
      otherEventId,
      createContext({ permissions: ['events:organizeAll'] }),
    );
    expect(response.status).toBe(404);
    expect(await response.text()).toBe('Event not found.');
    const unknown = await download(
      'does-not-exist',
      createContext({ permissions: ['events:organizeAll'] }),
    );
    expect(unknown.status).toBe(404);
  });

  it('exports the overview rows for events:organizeAll', async () => {
    const response = await download(
      eventId,
      createContext({ permissions: ['events:organizeAll'] }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe(
      'text/csv; charset=utf-8',
    );
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('Content-Disposition')).toBe(
      `attachment; filename="spring-hike-registrations.csv"; filename*=UTF-8''Spring%20Hike-registrations.csv`,
    );

    const { hasBom, text } = await readBody(response);
    expect(hasBom).toBe(true);
    expect(text).toBe(
      [
        '﻿First name,Last name,Email,Registration option,Organizer,Status,Checked in,Check-in time,Task,Shirt size',
        'organizer,Viewer,organizer.contact@example.com,Crew,Yes,Confirmed,No,,"Gate, ""north""",',
        'pia,Viewer,pia.contact@example.com,Applicants,No,Pending,No,,,',
        "anna,Viewer,anna.contact@example.com,Hikers,No,Confirmed,Yes,2026-09-15 12:05,,'=1+1",
        'bert,Viewer,bert.contact@example.com,Hikers,No,Confirmed,No,,,',
        '',
      ].join('\r\n'),
    );
    for (const excluded of ['wanda', 'carl', 'fred']) {
      expect(text).not.toContain(`${excluded}.contact@example.com`);
    }
    // The export lists contact addresses, like the organize overview.
    expect(text).not.toContain('anna@example.com');
  });

  it('allows a user with a confirmed organizer registration', async () => {
    const response = await download(
      eventId,
      createContext({ user: 'organizer' }),
    );
    expect(response.status).toBe(200);
    const { text } = await readBody(response);
    expect(text).toContain('organizer.contact@example.com');
  });

  it('denies a registered non-organizer participant', async () => {
    const response = await download(eventId, createContext({ user: 'anna' }));
    expect(response.status).toBe(403);
  });
});
