import { afterAll, beforeAll, describe, expect, it } from '@effect/vitest';
import { and, eq, inArray } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { ConfigProvider, Effect, Layer } from 'effect';
import * as Headers from 'effect/unstable/http/Headers';
import { Pool, type PoolClient } from 'pg';

import { databaseLayer } from '../../../../../db';
import { createId } from '../../../../../db/create-id';
import { createNodePgPoolConfig } from '../../../../../db/pg-connection-config';
import { relations } from '../../../../../db/relations';
import {
  eventInstances,
  eventRegistrationOptions,
  eventTemplateCategories,
  eventTemplates,
  platformAuditEntries,
  roles,
  rolesToTenantUsers,
  tenants,
  users,
  usersToTenants,
} from '../../../../../db/schema';
import { type Permission } from '../../../../../shared/permissions/permissions';
import {
  RpcRequestContext,
  type RpcRequestContextShape,
} from '../../../../../shared/rpc-contracts/app-rpcs';
import { PlatformAdministratorAuthority } from '../../../../../types/custom/platform-authority';
import { platformEventHandlers } from '../platform/platform-events.handlers';
import { platformTenantAdminHandlers } from '../platform/platform-tenant-admin.handlers';
import { RpcAccess } from '../shared/rpc-access.service';
import { eventQueryHandlers } from './events-query.handlers';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for PostgreSQL integration tests');
}

type TestDatabase = NodePgDatabase<typeof relations>;

const tenantId = createId();
const otherTenantId = createId();
const creatorId = createId();
const otherCreatorId = createId();
const matchingUserId = createId();
const nonmatchingUserId = createId();
const defaultRoleId = createId();
const matchingRoleId = createId();
const nonmatchingRoleId = createId();
const raceRoleId = createId();
const otherTenantRoleId = createId();
const categoryId = createId();
const otherCategoryId = createId();
const templateId = createId();
const otherTemplateId = createId();
const defaultAnnouncementId = createId();
const matchingAnnouncementId = createId();
const linkOnlyAnnouncementId = createId();
const raceAnnouncementId = createId();
const optionfulMatchingId = createId();
const optionfulUnrestrictedId = createId();
const optionfulDefaultRoleId = createId();
const draftRestrictedId = createId();
const otherTenantAnnouncementId = createId();
const optionfulMatchingOptionId = createId();
const optionfulUnrestrictedOptionId = createId();
const optionfulDefaultRoleOptionId = createId();
const draftRestrictedOptionId = createId();
const membershipIds = [createId(), createId()] as const;
const eventIds = [
  defaultAnnouncementId,
  matchingAnnouncementId,
  linkOnlyAnnouncementId,
  raceAnnouncementId,
  optionfulMatchingId,
  optionfulUnrestrictedId,
  optionfulDefaultRoleId,
  draftRestrictedId,
  otherTenantAnnouncementId,
] as const;
const userIds = [
  creatorId,
  otherCreatorId,
  matchingUserId,
  nonmatchingUserId,
] as const;
const handlerOptions = { headers: Headers.fromInput({}) };

const tenantContext = {
  cancellationDeadlineHoursBeforeStart: 120,
  currency: 'EUR' as const,
  defaultLocation: null,
  discountProviders: {
    esnCard: { config: {}, status: 'disabled' as const },
  },
  domain: `${tenantId}.announcement-discovery.example`,
  id: tenantId,
  maxActiveRegistrationsPerUser: 0,
  name: 'Announcement discovery',
  receiptSettings: {
    allowOther: false,
    receiptCountries: ['NL'],
  },
  refundFeesOnCancellation: true,
  stripeAccountId: null,
  theme: 'evorto' as const,
  timezone: 'Europe/Berlin',
  transferDeadlineHoursBeforeStart: 0,
} satisfies RpcRequestContextShape['tenant'];

const anonymousContext = {
  authData: {},
  authenticated: false,
  permissions: [],
  tenant: tenantContext,
  user: null,
  userAssigned: false,
} satisfies RpcRequestContextShape;

const authenticatedContext = ({
  permissions = [],
  roleIds,
  userId,
}: {
  permissions?: readonly Permission[];
  roleIds: readonly string[];
  userId: string;
}) =>
  ({
    authData: {},
    authenticated: true,
    permissions,
    tenant: tenantContext,
    user: {
      auth0Id: `auth0|${userId}`,
      communicationEmail: `${userId}@example.com`,
      email: `${userId}@example.com`,
      firstName: 'Announcement',
      id: userId,
      lastName: 'Viewer',
      permissions,
      roleIds,
    },
    userAssigned: true,
  }) satisfies RpcRequestContextShape;

const platformAuthority = PlatformAdministratorAuthority.make({
  actorEmail: 'platform-announcement@example.com',
  actorId: 'auth0|platform-announcement-discovery',
  kind: 'platformAdministrator',
});

const platformContext = {
  ...anonymousContext,
  authenticated: true,
  platformAuthority,
} satisfies RpcRequestContextShape;

const configLayer = ConfigProvider.layer(
  ConfigProvider.fromEnv({
    env: {
      DATABASE_URL: databaseUrl,
    },
  }),
);
const handlerLayer = Layer.mergeAll(
  databaseLayer.pipe(Layer.provide(configLayer)),
  RpcAccess.Default,
);

const runEventList = (
  context: RpcRequestContextShape,
  status: readonly ('APPROVED' | 'DRAFT' | 'PENDING_REVIEW')[] = ['APPROVED'],
) =>
  Effect.runPromise(
    eventQueryHandlers['events.eventList'](
      {
        limit: 100,
        offset: 0,
        startAfter: '2099-01-01T00:00:00.000Z',
        status: [...status],
      },
      handlerOptions,
    ).pipe(
      Effect.provideService(RpcRequestContext, context),
      Effect.provide(handlerLayer),
    ),
  );

const listedEventIds = (
  days: Awaited<ReturnType<typeof runEventList>>,
): string[] =>
  days.flatMap((day) => day.events.map((event) => event.id)).toSorted();

const runFindOne = (context: RpcRequestContextShape, id: string) =>
  Effect.runPromise(
    eventQueryHandlers['events.findOne']({ id }, handlerOptions).pipe(
      Effect.provideService(RpcRequestContext, context),
      Effect.provide(handlerLayer),
    ),
  );

const runPlatformAnnouncementDiscoveryUpdate = (
  eventId: string,
  announcementRoleIds: readonly string[],
) =>
  Effect.runPromise(
    platformEventHandlers['platform.events.updateAnnouncementDiscovery'](
      {
        announcementRoleIds: [...announcementRoleIds],
        eventId,
        reason: 'Verify announcement discovery role integrity',
        targetTenantId: tenantId,
      },
      handlerOptions,
    ).pipe(
      Effect.match({
        onFailure: (error) => ({ error, status: 'failure' as const }),
        onSuccess: (event) => ({ event, status: 'success' as const }),
      }),
      Effect.provideService(RpcRequestContext, platformContext),
      Effect.provide(handlerLayer),
    ),
  );

const runRoleDeletion = () =>
  Effect.runPromise(
    platformTenantAdminHandlers['platform.roles.delete'](
      {
        reason: 'Verify announcement discovery role integrity',
        roleId: raceRoleId,
        targetTenantId: tenantId,
      },
      handlerOptions,
    ).pipe(
      Effect.match({
        onFailure: (error) => ({ error, status: 'failure' as const }),
        onSuccess: () => ({ status: 'success' as const }),
      }),
      Effect.provideService(RpcRequestContext, platformContext),
      Effect.provide(handlerLayer),
    ),
  );

const waitForBlockedRoleGraphLocks = async (
  pool: Pool,
  minimumCount: number,
) => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const blocked = await pool.query<{ count: string }>(`
      SELECT count(*)::text AS count
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND pid <> pg_backend_pid()
        AND wait_event_type = 'Lock'
        AND query ILIKE '%pg_advisory_xact_lock%'
    `);
    if (Number(blocked.rows[0]?.count ?? 0) >= minimumCount) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(
    `Timed out waiting for ${minimumCount} blocked role-graph locks`,
  );
};

const lockTenantRoleGraph = async (
  client: PoolClient,
  targetTenantId: string,
) => {
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
    `evorto:tenant-role-graph:${targetTenantId}`,
  ]);
};

describe('optionless announcement discovery', () => {
  let database: TestDatabase;
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool(createNodePgPoolConfig({ databaseUrl }));
    database = drizzle({ client: pool, relations });

    await database.insert(tenants).values([
      {
        domain: tenantContext.domain,
        id: tenantId,
        name: tenantContext.name,
      },
      {
        domain: `${otherTenantId}.announcement-discovery.example`,
        id: otherTenantId,
        name: 'Other announcement tenant',
      },
    ]);
    await database.insert(users).values([
      {
        auth0Id: `auth0|${creatorId}`,
        communicationEmail: `${creatorId}@example.com`,
        email: `${creatorId}@example.com`,
        firstName: 'Primary',
        id: creatorId,
        lastName: 'Creator',
      },
      {
        auth0Id: `auth0|${otherCreatorId}`,
        communicationEmail: `${otherCreatorId}@example.com`,
        email: `${otherCreatorId}@example.com`,
        firstName: 'Other',
        id: otherCreatorId,
        lastName: 'Creator',
      },
      {
        auth0Id: `auth0|${matchingUserId}`,
        communicationEmail: `${matchingUserId}@example.com`,
        email: `${matchingUserId}@example.com`,
        firstName: 'Matching',
        id: matchingUserId,
        lastName: 'Viewer',
      },
      {
        auth0Id: `auth0|${nonmatchingUserId}`,
        communicationEmail: `${nonmatchingUserId}@example.com`,
        email: `${nonmatchingUserId}@example.com`,
        firstName: 'Nonmatching',
        id: nonmatchingUserId,
        lastName: 'Viewer',
      },
    ]);
    await database.insert(usersToTenants).values([
      {
        id: membershipIds[0],
        tenantId,
        userId: matchingUserId,
      },
      {
        id: membershipIds[1],
        tenantId,
        userId: nonmatchingUserId,
      },
    ]);
    await database.insert(roles).values([
      {
        defaultUserRole: true,
        id: defaultRoleId,
        name: 'Default announcement viewer',
        tenantId,
      },
      {
        id: matchingRoleId,
        name: 'Matching announcement viewer',
        tenantId,
      },
      {
        id: nonmatchingRoleId,
        name: 'Nonmatching announcement viewer',
        tenantId,
      },
      {
        id: raceRoleId,
        name: 'Concurrent announcement viewer',
        tenantId,
      },
      {
        defaultUserRole: true,
        id: otherTenantRoleId,
        name: 'Other tenant announcement viewer',
        tenantId: otherTenantId,
      },
    ]);
    await database.insert(rolesToTenantUsers).values([
      {
        roleId: matchingRoleId,
        tenantId,
        userTenantId: membershipIds[0],
      },
      {
        roleId: nonmatchingRoleId,
        tenantId,
        userTenantId: membershipIds[1],
      },
    ]);
    await database.insert(eventTemplateCategories).values([
      {
        icon: { iconColor: 0, iconName: 'circle' },
        id: categoryId,
        tenantId,
        title: 'Announcement discovery',
      },
      {
        icon: { iconColor: 0, iconName: 'circle' },
        id: otherCategoryId,
        tenantId: otherTenantId,
        title: 'Other announcement discovery',
      },
    ]);
    await database.insert(eventTemplates).values([
      {
        categoryId,
        description: 'Announcement discovery fixture',
        icon: { iconColor: 0, iconName: 'circle' },
        id: templateId,
        tenantId,
        title: 'Announcement discovery',
      },
      {
        categoryId: otherCategoryId,
        description: 'Other tenant announcement fixture',
        icon: { iconColor: 0, iconName: 'circle' },
        id: otherTemplateId,
        tenantId: otherTenantId,
        title: 'Other announcement discovery',
      },
    ]);

    const start = new Date('2100-01-02T10:00:00.000Z');
    const end = new Date('2100-01-02T12:00:00.000Z');
    const primaryEvents: (typeof eventInstances.$inferInsert)[] = [
      {
        announcementRoleIds: [defaultRoleId],
        creatorId,
        description: 'Default-role announcement',
        end,
        icon: { iconColor: 0, iconName: 'circle' },
        id: defaultAnnouncementId,
        reviewedAt: new Date('2099-12-01T00:00:00.000Z'),
        reviewedBy: creatorId,
        start,
        status: 'APPROVED',
        templateId,
        tenantId,
        title: 'Default-role announcement',
      },
      {
        announcementRoleIds: [matchingRoleId],
        creatorId,
        description: 'Matching-role announcement',
        end,
        icon: { iconColor: 0, iconName: 'circle' },
        id: matchingAnnouncementId,
        reviewedAt: new Date('2099-12-01T00:00:00.000Z'),
        reviewedBy: creatorId,
        start,
        status: 'APPROVED',
        templateId,
        tenantId,
        title: 'Matching-role announcement',
      },
      {
        announcementRoleIds: [],
        creatorId,
        description: 'Link-only announcement',
        end,
        icon: { iconColor: 0, iconName: 'circle' },
        id: linkOnlyAnnouncementId,
        reviewedAt: new Date('2099-12-01T00:00:00.000Z'),
        reviewedBy: creatorId,
        start,
        status: 'APPROVED',
        templateId,
        tenantId,
        title: 'Link-only announcement',
      },
      {
        announcementRoleIds: [],
        creatorId,
        description: 'Concurrent role announcement',
        end,
        icon: { iconColor: 0, iconName: 'circle' },
        id: raceAnnouncementId,
        reviewedAt: new Date('2099-12-01T00:00:00.000Z'),
        reviewedBy: creatorId,
        start,
        status: 'APPROVED',
        templateId,
        tenantId,
        title: 'Concurrent role announcement',
      },
      {
        creatorId,
        description: 'Matching optionful event',
        end,
        icon: { iconColor: 0, iconName: 'circle' },
        id: optionfulMatchingId,
        reviewedAt: new Date('2099-12-01T00:00:00.000Z'),
        reviewedBy: creatorId,
        start,
        status: 'APPROVED',
        templateId,
        tenantId,
        title: 'Matching optionful event',
      },
      {
        creatorId,
        description: 'Unrestricted optionful event',
        end,
        icon: { iconColor: 0, iconName: 'circle' },
        id: optionfulUnrestrictedId,
        reviewedAt: new Date('2099-12-01T00:00:00.000Z'),
        reviewedBy: creatorId,
        start,
        status: 'APPROVED',
        templateId,
        tenantId,
        title: 'Unrestricted optionful event',
      },
      {
        creatorId,
        description: 'Default-role optionful event',
        end,
        icon: { iconColor: 0, iconName: 'circle' },
        id: optionfulDefaultRoleId,
        reviewedAt: new Date('2099-12-01T00:00:00.000Z'),
        reviewedBy: creatorId,
        start,
        status: 'APPROVED',
        templateId,
        tenantId,
        title: 'Default-role optionful event',
      },
      {
        creatorId,
        description: 'Restricted draft event',
        end,
        icon: { iconColor: 0, iconName: 'circle' },
        id: draftRestrictedId,
        start,
        status: 'DRAFT',
        templateId,
        tenantId,
        title: 'Restricted draft event',
      },
    ];
    await database.insert(eventInstances).values([
      ...primaryEvents,
      {
        announcementRoleIds: [otherTenantRoleId],
        creatorId: otherCreatorId,
        description: 'Other tenant announcement',
        end,
        icon: { iconColor: 0, iconName: 'circle' },
        id: otherTenantAnnouncementId,
        reviewedAt: new Date('2099-12-01T00:00:00.000Z'),
        reviewedBy: otherCreatorId,
        start,
        status: 'APPROVED',
        templateId: otherTemplateId,
        tenantId: otherTenantId,
        title: 'Other tenant announcement',
      },
    ]);
    await database.insert(eventRegistrationOptions).values([
      {
        closeRegistrationTime: new Date('2100-01-01T23:00:00.000Z'),
        eventId: optionfulMatchingId,
        id: optionfulMatchingOptionId,
        isPaid: false,
        openRegistrationTime: new Date('2099-12-01T00:00:00.000Z'),
        organizingRegistration: false,
        price: 0,
        registrationMode: 'fcfs',
        roleIds: [matchingRoleId],
        spots: 20,
        title: 'Matching participant',
      },
      {
        closeRegistrationTime: new Date('2100-01-01T23:00:00.000Z'),
        eventId: optionfulUnrestrictedId,
        id: optionfulUnrestrictedOptionId,
        isPaid: false,
        openRegistrationTime: new Date('2099-12-01T00:00:00.000Z'),
        organizingRegistration: false,
        price: 0,
        registrationMode: 'fcfs',
        roleIds: [],
        spots: 20,
        title: 'Unrestricted participant',
      },
      {
        closeRegistrationTime: new Date('2100-01-01T23:00:00.000Z'),
        eventId: optionfulDefaultRoleId,
        id: optionfulDefaultRoleOptionId,
        isPaid: false,
        openRegistrationTime: new Date('2099-12-01T00:00:00.000Z'),
        organizingRegistration: false,
        price: 0,
        registrationMode: 'fcfs',
        roleIds: [defaultRoleId],
        spots: 20,
        title: 'Default-role participant',
      },
      {
        closeRegistrationTime: new Date('2100-01-01T23:00:00.000Z'),
        eventId: draftRestrictedId,
        id: draftRestrictedOptionId,
        isPaid: false,
        openRegistrationTime: new Date('2099-12-01T00:00:00.000Z'),
        organizingRegistration: false,
        price: 0,
        registrationMode: 'fcfs',
        roleIds: [matchingRoleId],
        spots: 20,
        title: 'Restricted draft participant',
      },
    ]);
  });

  afterAll(async () => {
    await database
      .delete(platformAuditEntries)
      .where(
        inArray(platformAuditEntries.targetTenantId, [tenantId, otherTenantId]),
      );
    await database
      .delete(eventRegistrationOptions)
      .where(
        inArray(eventRegistrationOptions.id, [
          optionfulMatchingOptionId,
          optionfulUnrestrictedOptionId,
          optionfulDefaultRoleOptionId,
          draftRestrictedOptionId,
        ]),
      );
    await database
      .delete(eventInstances)
      .where(inArray(eventInstances.id, eventIds));
    await database
      .delete(eventTemplates)
      .where(inArray(eventTemplates.id, [templateId, otherTemplateId]));
    await database
      .delete(eventTemplateCategories)
      .where(
        inArray(eventTemplateCategories.id, [categoryId, otherCategoryId]),
      );
    await database
      .delete(rolesToTenantUsers)
      .where(inArray(rolesToTenantUsers.tenantId, [tenantId, otherTenantId]));
    await database
      .delete(usersToTenants)
      .where(inArray(usersToTenants.tenantId, [tenantId, otherTenantId]));
    await database
      .delete(roles)
      .where(inArray(roles.tenantId, [tenantId, otherTenantId]));
    await database.delete(users).where(inArray(users.id, userIds));
    await database
      .delete(tenants)
      .where(inArray(tenants.id, [tenantId, otherTenantId]));
    await pool.end();
  });

  it('keeps announcement targeting separate from option eligibility and preserves direct links', async () => {
    expect(listedEventIds(await runEventList(anonymousContext))).toEqual(
      [optionfulDefaultRoleId, optionfulUnrestrictedId].toSorted(),
    );

    const matchingContext = authenticatedContext({
      roleIds: [matchingRoleId],
      userId: matchingUserId,
    });
    expect(listedEventIds(await runEventList(matchingContext))).toEqual(
      [
        matchingAnnouncementId,
        optionfulMatchingId,
        optionfulUnrestrictedId,
      ].toSorted(),
    );

    const nonmatchingContext = authenticatedContext({
      roleIds: [nonmatchingRoleId],
      userId: nonmatchingUserId,
    });
    expect(listedEventIds(await runEventList(nonmatchingContext))).toEqual([
      optionfulUnrestrictedId,
    ]);

    const rolelessContext = authenticatedContext({
      roleIds: [],
      userId: matchingUserId,
    });
    expect(listedEventIds(await runEventList(rolelessContext))).toEqual([
      optionfulUnrestrictedId,
    ]);

    const ineligibleDirectLinkEvent = await runFindOne(
      nonmatchingContext,
      optionfulMatchingId,
    );
    expect(ineligibleDirectLinkEvent).toMatchObject({
      hasRegistrationOptions: true,
      id: optionfulMatchingId,
      registrationOptions: [],
      registrationOptionsHiddenByEligibility: true,
    });

    const anonymousOptionfulEvent = await runFindOne(
      anonymousContext,
      optionfulDefaultRoleId,
    );
    expect(anonymousOptionfulEvent).toMatchObject({
      announcementRoleCount: 0,
      announcementRoleIds: null,
      reviewer: null,
      statusComment: null,
      userIsCreator: false,
    });
    expect(anonymousOptionfulEvent.registrationOptions).toHaveLength(1);
    expect(anonymousOptionfulEvent.registrationOptions[0]).not.toHaveProperty(
      'checkedInSpots',
    );
    expect(anonymousOptionfulEvent.registrationOptions[0]).not.toHaveProperty(
      'registeredDescription',
    );
    expect(anonymousOptionfulEvent.registrationOptions[0]).not.toHaveProperty(
      'roleIds',
    );
    expect(anonymousOptionfulEvent.registrationOptions[0]).not.toHaveProperty(
      'stripeTaxRateId',
    );

    const anonymousAnnouncement = await runFindOne(
      anonymousContext,
      defaultAnnouncementId,
    );
    expect(anonymousAnnouncement).toMatchObject({
      announcementRoleCount: 1,
      announcementRoleIds: null,
      reviewer: null,
      statusComment: null,
      userIsCreator: false,
    });

    const announcementEditorContext = authenticatedContext({
      permissions: ['events:changeAnnouncementDiscovery'],
      roleIds: [matchingRoleId],
      userId: matchingUserId,
    });
    const editableAnnouncement = await runFindOne(
      announcementEditorContext,
      matchingAnnouncementId,
    );
    expect(editableAnnouncement).toMatchObject({
      announcementRoleCount: 1,
      announcementRoleIds: [matchingRoleId],
      userIsCreator: false,
    });

    const creatorContext = authenticatedContext({
      roleIds: [],
      userId: creatorId,
    });
    expect(
      await runFindOne(creatorContext, linkOnlyAnnouncementId),
    ).toMatchObject({
      announcementRoleIds: null,
      userIsCreator: true,
    });

    const directLinkEvent = await runFindOne(
      nonmatchingContext,
      linkOnlyAnnouncementId,
    );
    expect(directLinkEvent).toMatchObject({
      announcementRoleCount: 0,
      announcementRoleIds: null,
      hasRegistrationOptions: false,
      id: linkOnlyAnnouncementId,
      userIsCreator: false,
    });
    await expect(
      runFindOne(nonmatchingContext, otherTenantAnnouncementId),
    ).rejects.toMatchObject({
      _tag: 'EventNotFoundError',
      id: otherTenantAnnouncementId,
    });
  });

  it('bypasses eligibility only for non-approved rows after the explicit draft permission gate', async () => {
    const draftViewerContext = authenticatedContext({
      permissions: ['events:seeDrafts'],
      roleIds: [nonmatchingRoleId],
      userId: nonmatchingUserId,
    });

    expect(
      listedEventIds(
        await runEventList(draftViewerContext, ['APPROVED', 'DRAFT']),
      ),
    ).toEqual([draftRestrictedId, optionfulUnrestrictedId].toSorted());

    const draft = await runFindOne(draftViewerContext, draftRestrictedId);
    expect(draft).toMatchObject({
      hasRegistrationOptions: true,
      id: draftRestrictedId,
      registrationOptionsHiddenByEligibility: false,
    });
    expect(draft.registrationOptions.map((option) => option.id)).toEqual([
      draftRestrictedOptionId,
    ]);
    expect(draft.registrationOptions[0]).not.toHaveProperty('roleIds');

    const approved = await runFindOne(draftViewerContext, optionfulMatchingId);
    expect(approved).toMatchObject({
      registrationOptions: [],
      registrationOptionsHiddenByEligibility: true,
    });
  });

  it('serializes platform announcement updates with role deletion', async () => {
    const foreignRoleUpdate = await runPlatformAnnouncementDiscoveryUpdate(
      raceAnnouncementId,
      [otherTenantRoleId],
    );
    expect(foreignRoleUpdate).toMatchObject({
      error: {
        _tag: 'RpcBadRequestError',
        reason: 'invalidAnnouncementRole',
      },
      status: 'failure',
    });

    const optionfulUpdate = await runPlatformAnnouncementDiscoveryUpdate(
      optionfulMatchingId,
      [],
    );
    expect(optionfulUpdate).toMatchObject({
      error: {
        _tag: 'RpcBadRequestError',
        reason: 'announcementRolesRequireOptionlessEvent',
      },
      status: 'failure',
    });

    const lockClient = await pool.connect();
    let lockReleased = false;
    let updatePromise:
      ReturnType<typeof runPlatformAnnouncementDiscoveryUpdate> | undefined;
    let deletePromise: ReturnType<typeof runRoleDeletion> | undefined;
    try {
      await lockTenantRoleGraph(lockClient, tenantId);
      updatePromise = runPlatformAnnouncementDiscoveryUpdate(
        raceAnnouncementId,
        [raceRoleId],
      );
      await waitForBlockedRoleGraphLocks(pool, 1);
      deletePromise = runRoleDeletion();
      await waitForBlockedRoleGraphLocks(pool, 2);
      await lockClient.query('COMMIT');
      lockReleased = true;

      const [updateResult, deleteResult] = await Promise.all([
        updatePromise,
        deletePromise,
      ]);

      const [storedEvent] = await database
        .select({ announcementRoleIds: eventInstances.announcementRoleIds })
        .from(eventInstances)
        .where(eq(eventInstances.id, raceAnnouncementId));
      const storedRole = await database.query.roles.findFirst({
        columns: { id: true },
        where: { id: raceRoleId, tenantId },
      });
      const auditEntries = await database
        .select({ action: platformAuditEntries.action })
        .from(platformAuditEntries)
        .where(
          and(
            eq(platformAuditEntries.targetTenantId, tenantId),
            inArray(platformAuditEntries.action, [
              'event.updateAnnouncementDiscovery',
              'role.delete',
            ]),
          ),
        );

      if (updateResult.status === 'success') {
        expect(deleteResult).toMatchObject({
          error: {
            _tag: 'RpcBadRequestError',
            reason: 'roleInUseByEventAnnouncement',
          },
          status: 'failure',
        });
        expect(storedEvent?.announcementRoleIds).toEqual([raceRoleId]);
        expect(storedRole).toEqual({ id: raceRoleId });
        expect(auditEntries).toEqual([
          { action: 'event.updateAnnouncementDiscovery' },
        ]);
      } else {
        expect(updateResult.error).toMatchObject({
          _tag: 'RpcBadRequestError',
          reason: 'invalidAnnouncementRole',
        });
        expect(deleteResult).toEqual({ status: 'success' });
        expect(storedEvent?.announcementRoleIds).toEqual([]);
        expect(storedRole).toBeUndefined();
        expect(auditEntries).toEqual([{ action: 'role.delete' }]);
      }
    } finally {
      if (!lockReleased) {
        await lockClient.query('ROLLBACK');
      }
      lockClient.release();
      await Promise.allSettled(
        [updatePromise, deletePromise].filter(
          (promise): promise is Promise<unknown> => promise !== undefined,
        ),
      );
    }
  });
});
