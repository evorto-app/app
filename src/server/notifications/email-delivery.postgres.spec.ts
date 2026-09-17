import { describe, expect, it, vi } from '@effect/vitest';
import { asc, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { ConfigProvider, Effect, Layer } from 'effect';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';

import type { EmailDeliveryRequest } from '../integrations/email-delivery';

import { databaseLayer } from '../../db/database.layer';
import { createNodePgPoolConfig } from '../../db/pg-connection-config';
import { relations } from '../../db/relations';
import { emailOutbox, tenants } from '../../db/schema';
import { EmailDelivery } from '../integrations/email-delivery';
import { processDueEmailOutbox } from './email-delivery';
import {
  emailOutboxAbandonedSendingPredicate,
  emailOutboxDispatchablePredicate,
  emailOutboxOverviewCandidates,
} from './email-outbox-lease';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for PostgreSQL integration tests');
}

const makeDatabaseServiceLayer = (url: string) =>
  databaseLayer.pipe(
    Layer.provide(
      ConfigProvider.layer(
        ConfigProvider.fromEnv({
          env: {
            DATABASE_TLS_REQUIRED: 'false',
            DATABASE_URL: url,
          },
        }),
      ),
    ),
  );

const acquireOutboxFixture = () =>
  Effect.gen(function* () {
    const pool = yield* Effect.acquireRelease(
      Effect.sync(() => new Pool(createNodePgPoolConfig({ databaseUrl }))),
      (acquiredPool) => Effect.promise(() => acquiredPool.end()),
    );
    const database = drizzle({ client: pool, relations });
    const suffix = randomUUID().replaceAll('-', '').slice(0, 8);
    const tenantId = `mail-${suffix}`;
    const emailIds = {
      expired: `expired-${suffix}`,
      missingExpiry: `missing-exp-${suffix}`,
      missingId: `missing-id-${suffix}`,
      queued: `queued-${suffix}`,
    };
    const ownedIds = Object.values(emailIds);
    // Install ownership before the first write, including unexpected constraint success.
    // ensuring attempts both dependent deletions and preserves either cleanup failure.
    yield* Effect.addFinalizer(() =>
      Effect.promise(() =>
        database.delete(emailOutbox).where(inArray(emailOutbox.id, ownedIds)),
      ).pipe(
        Effect.ensuring(
          Effect.promise(() =>
            database.delete(tenants).where(eq(tenants.id, tenantId)),
          ),
        ),
        Effect.asVoid,
      ),
    );
    yield* Effect.promise(() =>
      database.insert(tenants).values({
        currency: 'EUR',
        domain: `${suffix}.mail-outbox.example`,
        id: tenantId,
        name: `Mail outbox ${suffix}`,
      }),
    );
    const baseEmail = {
      html: '<p>Hello</p>',
      kind: 'registrationConfirmed',
      subject: 'Registration confirmed',
      tenantId,
      text: 'Hello',
      toEmail: `member-${suffix}@example.org`,
    } satisfies Omit<typeof emailOutbox.$inferInsert, 'idempotencyKey'>;
    return { baseEmail, database, emailIds, ownedIds, tenantId };
  });

const unknownMessage =
  'Evorto could not confirm whether this email was sent. It will not send it again, to avoid sending it twice.';

interface OutboxOverviewPlanNode {
  actualLoops: number;
  actualRows: number;
  indexName: null | string;
  nodeType: string;
}

const outboxOverviewPlanNodes = (value: unknown): OutboxOverviewPlanNode[] => {
  if (Array.isArray(value))
    return value.flatMap((node) => outboxOverviewPlanNodes(node));
  if (typeof value !== 'object' || value === null)
    throw new Error('Expected PostgreSQL EXPLAIN JSON');
  if ('Plan' in value) return outboxOverviewPlanNodes(value.Plan);
  if (
    !('Node Type' in value) ||
    typeof value['Node Type'] !== 'string' ||
    !('Actual Rows' in value) ||
    typeof value['Actual Rows'] !== 'number' ||
    !('Actual Loops' in value) ||
    typeof value['Actual Loops'] !== 'number'
  )
    throw new Error('Expected an analyzed PostgreSQL plan node');
  return [
    {
      actualLoops: value['Actual Loops'],
      actualRows: value['Actual Rows'],
      indexName:
        'Index Name' in value && typeof value['Index Name'] === 'string'
          ? value['Index Name']
          : null,
      nodeType: value['Node Type'],
    },
    ...('Plans' in value ? outboxOverviewPlanNodes(value.Plans) : []),
  ];
};

describe('email outbox single-dispatch state transitions', () => {
  it.effect(
    'prioritizes older incomplete diagnostics with bounded indexed candidates and an unforced plan',
    () =>
      Effect.gen(function* () {
        const { baseEmail, database, ownedIds, tenantId } =
          yield* acquireOutboxFixture();
        const fixtureSuffix = tenantId.slice(-8);
        const insertRows = (rows: (typeof emailOutbox.$inferInsert)[]) => {
          for (const row of rows) {
            if (!row.id)
              throw new Error('Overview fixture rows require owned IDs');
            ownedIds.push(row.id);
          }
          return Effect.promise(() =>
            database.insert(emailOutbox).values(rows),
          );
        };
        const history = Array.from({ length: 1200 }, (_, index) => ({
          ...baseEmail,
          attempts: 1,
          id: `sent-${fixtureSuffix}-${String(index).padStart(4, '0')}`,
          idempotencyKey: `history/${fixtureSuffix}/${index}`,
          sentAt: new Date('2026-01-01T00:00:00Z'),
          status: 'sent' as const,
          updatedAt: new Date('2026-01-01T00:00:00Z'),
        }));
        yield* insertRows(history.slice(0, 600));
        yield* insertRows(history.slice(600));
        const incidentIds = [
          'failed',
          'unknown',
          'no-id',
          'no-exp',
          'expired',
          'no-attempt',
          'no-sent',
          'no-sup-time',
          'no-sup-at',
          'no-sup-both',
        ].map((kind) => `${kind}-${fixtureSuffix}`);
        yield* insertRows([
          {
            ...baseEmail,
            attempts: 1,
            id: `failed-${fixtureSuffix}`,
            idempotencyKey: `failed/${fixtureSuffix}`,
            status: 'failed',
            updatedAt: new Date(1000),
          },
          {
            ...baseEmail,
            attempts: 1,
            id: `unknown-${fixtureSuffix}`,
            idempotencyKey: `unknown/${fixtureSuffix}`,
            status: 'deliveryUnknown',
            updatedAt: new Date(1000),
          },
          {
            ...baseEmail,
            attempts: 1,
            claimLeaseExpiresAt: new Date('2099-01-01'),
            id: `no-id-${fixtureSuffix}`,
            idempotencyKey: `no-id/${fixtureSuffix}`,
            lastAttemptAt: new Date(500),
            status: 'sending',
            updatedAt: new Date(1000),
          },
          {
            ...baseEmail,
            attempts: 1,
            claimLeaseId: 'owned',
            id: `no-exp-${fixtureSuffix}`,
            idempotencyKey: `no-exp/${fixtureSuffix}`,
            lastAttemptAt: new Date(500),
            status: 'sending',
            updatedAt: new Date(1000),
          },
          {
            ...baseEmail,
            attempts: 1,
            claimLeaseExpiresAt: new Date(0),
            claimLeaseId: 'owned',
            id: `expired-${fixtureSuffix}`,
            idempotencyKey: `expired/${fixtureSuffix}`,
            lastAttemptAt: new Date(500),
            status: 'sending',
            updatedAt: new Date(1000),
          },
          {
            ...baseEmail,
            attempts: 1,
            claimLeaseExpiresAt: new Date('2099-01-01'),
            claimLeaseId: 'active-with-missing-attempt',
            id: `no-attempt-${fixtureSuffix}`,
            idempotencyKey: `no-attempt/${fixtureSuffix}`,
            status: 'sending',
            updatedAt: new Date(1000),
          },
          {
            ...baseEmail,
            attempts: 1,
            id: `no-sent-${fixtureSuffix}`,
            idempotencyKey: `no-sent/${fixtureSuffix}`,
            status: 'sent',
            updatedAt: new Date(1000),
          },
          {
            ...baseEmail,
            attempts: 1,
            id: `no-sup-time-${fixtureSuffix}`,
            idempotencyKey: `no-sup-time/${fixtureSuffix}`,
            lastAttemptAt: new Date(500),
            status: 'suppressed',
            updatedAt: new Date(1000),
          },
          {
            ...baseEmail,
            attempts: 1,
            id: `no-sup-at-${fixtureSuffix}`,
            idempotencyKey: `no-sup-at/${fixtureSuffix}`,
            status: 'suppressed',
            suppressedAt: new Date(500),
            updatedAt: new Date(1000),
          },
          {
            ...baseEmail,
            attempts: 1,
            id: `no-sup-both-${fixtureSuffix}`,
            idempotencyKey: `no-sup-both/${fixtureSuffix}`,
            status: 'suppressed',
            updatedAt: new Date(1000),
          },
          ...(['queued', 'sending', 'suppressed'] as const).map((status) => ({
            ...baseEmail,
            attempts: status === 'queued' ? 0 : 1,
            claimLeaseExpiresAt: new Date('2099-01-01'),
            claimLeaseId: 'active',
            id: `${status}-${fixtureSuffix}`,
            idempotencyKey: `routine/${status}/${fixtureSuffix}`,
            lastAttemptAt: status === 'queued' ? null : new Date('2027-01-01'),
            status,
            suppressedAt:
              status === 'suppressed' ? new Date('2027-01-01') : null,
            updatedAt: new Date('2027-01-01'),
          })),
        ]);
        const readPage = () => {
          const candidates = emailOutboxOverviewCandidates();
          return database
            .select()
            .from(candidates)
            .orderBy(
              asc(candidates.incidentRank),
              desc(candidates.updatedAt),
              asc(candidates.id),
            );
        };
        // Independent full-table reference: do not reuse the candidate predicate.
        const referenceIncidentRank = sql<number>`case when
          ${emailOutbox.status} in ('failed', 'deliveryUnknown')
          or (${emailOutbox.status} = 'sending' and (
            ${emailOutbox.lastAttemptAt} is null
            or ${emailOutbox.claimLeaseId} is null
            or ${emailOutbox.claimLeaseExpiresAt} is null
            or ${emailOutbox.claimLeaseExpiresAt} <= now()
          ))
          or (${emailOutbox.status} = 'sent' and ${emailOutbox.sentAt} is null)
          or (${emailOutbox.status} = 'suppressed' and (
            ${emailOutbox.suppressedAt} is null
            or ${emailOutbox.lastAttemptAt} is null
          ))
          then 0 else 1 end`;
        const referencePage = () =>
          database
            .select({
              id: emailOutbox.id,
              incidentRank: referenceIncidentRank,
              updatedAt: emailOutbox.updatedAt,
            })
            .from(emailOutbox)
            .orderBy(
              asc(referenceIncidentRank),
              desc(emailOutbox.updatedAt),
              asc(emailOutbox.id),
            )
            .limit(100);
        const first = yield* Effect.promise(readPage);
        expect(first).toEqual(yield* Effect.promise(referencePage));
        expect(first).toHaveLength(100);
        expect(first.slice(0, incidentIds.length).map((row) => row.id)).toEqual(
          incidentIds.toSorted(),
        );
        expect(
          first
            .slice(incidentIds.length, incidentIds.length + 3)
            .map((row) => row.id),
        ).toEqual(
          ['queued', 'sending', 'suppressed'].map(
            (status) => `${status}-${fixtureSuffix}`,
          ),
        );
        expect(new Set(first.map((row) => row.id)).size).toBe(100);

        // Use ordinary planner settings; never disable sequential scans or force an index.
        yield* Effect.promise(() =>
          database.execute(sql`analyze ${emailOutbox}`),
        );
        const explained = yield* Effect.promise(() =>
          database.execute<{ 'QUERY PLAN': unknown }>(sql`
            explain (analyze, buffers, costs false, timing false, summary false, format json)
            ${readPage()}
          `),
        );
        const planNodes = outboxOverviewPlanNodes(
          explained.rows[0]?.['QUERY PLAN'],
        );
        const incompleteScans = planNodes.filter(
          (node) => node.indexName === 'email_outbox_incomplete_terminal_idx',
        );
        expect(
          incompleteScans.length,
          JSON.stringify(explained.rows),
        ).toBeGreaterThanOrEqual(2);
        for (const scan of incompleteScans) {
          expect(scan.actualRows * scan.actualLoops).toBeLessThanOrEqual(100);
        }
        const candidateStreams = planNodes.filter(
          (node) =>
            node.nodeType === 'Append' || node.nodeType === 'Merge Append',
        );
        expect(
          candidateStreams.length,
          JSON.stringify(explained.rows),
        ).toBeGreaterThan(0);
        for (const candidates of candidateStreams) {
          // Nine disjoint buckets each return at most one 100-row page.
          expect(
            candidates.actualRows * candidates.actualLoops,
          ).toBeLessThanOrEqual(900);
        }

        yield* insertRows(
          Array.from({ length: 105 }, (_, index) => ({
            ...baseEmail,
            attempts: 1,
            id: `older-${fixtureSuffix}-${String(index).padStart(3, '0')}`,
            idempotencyKey: `older/${fixtureSuffix}/${index}`,
            status: 'failed',
            updatedAt: new Date(0),
          })),
        );
        const incidentPage = yield* Effect.promise(readPage);
        expect(incidentPage).toEqual(yield* Effect.promise(referencePage));
        expect(incidentPage).toHaveLength(100);
        expect(incidentPage.every((row) => row.incidentRank === 0)).toBe(true);
      }),
  );

  it.effect(
    'terminalizes accepted-then-crash ambiguity before dispatching new mail',
    () =>
      Effect.gen(function* () {
        const { baseEmail, database, emailIds, ownedIds, tenantId } =
          yield* acquireOutboxFixture();
        // This global dispatcher proof requires the isolated integration database without
        // an active worker or concurrent outbox producers. Never clean up another test's rows.
        const existingCandidates = yield* Effect.promise(() =>
          database
            .select({ id: emailOutbox.id })
            .from(emailOutbox)
            .where(
              or(
                emailOutboxDispatchablePredicate(),
                emailOutboxAbandonedSendingPredicate(),
              ),
            ),
        );
        expect(
          existingCandidates,
          'Single-dispatch PostgreSQL proof requires an idle, isolated outbox',
        ).toEqual([]);
        yield* Effect.promise(() =>
          database.insert(emailOutbox).values([
            {
              ...baseEmail,
              id: emailIds.queued,
              idempotencyKey: `single-dispatch/${tenantId}/${emailIds.queued}`,
            },
            {
              ...baseEmail,
              attempts: 1,
              claimLeaseExpiresAt: new Date(0),
              claimLeaseId: `lease-${emailIds.expired}`,
              id: emailIds.expired,
              idempotencyKey: `single-dispatch/${tenantId}/${emailIds.expired}`,
              lastAttemptAt: new Date(0),
              status: 'sending',
            },
            {
              ...baseEmail,
              attempts: 1,
              claimLeaseId: `lease-${emailIds.missingExpiry}`,
              id: emailIds.missingExpiry,
              idempotencyKey: `single-dispatch/${tenantId}/${emailIds.missingExpiry}`,
              lastAttemptAt: new Date(0),
              status: 'sending',
            },
            {
              ...baseEmail,
              attempts: 1,
              claimLeaseExpiresAt: new Date(Date.now() + 600_000),
              id: emailIds.missingId,
              idempotencyKey: `single-dispatch/${tenantId}/${emailIds.missingId}`,
              lastAttemptAt: new Date(0),
              status: 'sending',
            },
          ]),
        );
        const deliver = vi.fn((request: EmailDeliveryRequest) =>
          Effect.sync(() => {
            expect(request.to).toBe(baseEmail.toEmail);
            return {
              _tag: 'Delivered',
              provider: 'fake',
              providerMessageId: `fake-${emailIds.queued}`,
            } as const;
          }),
        );
        const deliveryLayer = EmailDelivery.layerFake(deliver);
        const processed = yield* processDueEmailOutbox(10).pipe(
          Effect.provide(makeDatabaseServiceLayer(databaseUrl)),
          Effect.provide(deliveryLayer),
        );
        expect(processed).toBe(1);
        expect(deliver).toHaveBeenCalledOnce();
        const rows = yield* Effect.promise(() =>
          database
            .select()
            .from(emailOutbox)
            .where(inArray(emailOutbox.id, ownedIds)),
        );
        expect(rows).toHaveLength(4);
        expect(rows).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              attempts: 1,
              claimLeaseExpiresAt: null,
              claimLeaseId: null,
              id: emailIds.queued,
              lastError: null,
              provider: 'fake',
              providerMessageId: `fake-${emailIds.queued}`,
              sentAt: expect.any(Date),
              status: 'sent',
            }),
            ...[
              emailIds.expired,
              emailIds.missingExpiry,
              emailIds.missingId,
            ].map((id) =>
              expect.objectContaining({
                attempts: 1,
                claimLeaseExpiresAt: null,
                claimLeaseId: null,
                deliveryUnknownAt: expect.any(Date),
                id,
                lastError: unknownMessage,
                status: 'deliveryUnknown',
              }),
            ),
          ]),
        );
        expect(
          yield* processDueEmailOutbox(10).pipe(
            Effect.provide(makeDatabaseServiceLayer(databaseUrl)),
            Effect.provide(deliveryLayer),
          ),
        ).toBe(0);
        expect(deliver).toHaveBeenCalledOnce();
      }),
  );

  it.effect('rejects requeueing an already attempted row', () =>
    Effect.gen(function* () {
      const { baseEmail, database, emailIds, tenantId } =
        yield* acquireOutboxFixture();
      yield* Effect.promise(() =>
        database.insert(emailOutbox).values({
          ...baseEmail,
          attempts: 1,
          id: emailIds.queued,
          idempotencyKey: `constraint/${tenantId}`,
          status: 'failed',
        }),
      );
      yield* Effect.promise(() =>
        expect(
          database
            .update(emailOutbox)
            .set({ status: 'queued' })
            .where(eq(emailOutbox.id, emailIds.queued)),
        ).rejects.toMatchObject({
          cause: {
            code: '23514',
            constraint: 'email_outbox_single_dispatch_attempts_check',
          },
        }),
      );
      const rows = yield* Effect.promise(() =>
        database
          .select({
            attempts: emailOutbox.attempts,
            status: emailOutbox.status,
          })
          .from(emailOutbox)
          .where(eq(emailOutbox.id, emailIds.queued)),
      );
      expect(rows).toEqual([{ attempts: 1, status: 'failed' }]);
    }),
  );

  it.effect('rejects a second dispatch attempt for a sent row', () =>
    Effect.gen(function* () {
      const { baseEmail, database, emailIds, tenantId } =
        yield* acquireOutboxFixture();
      yield* Effect.promise(() =>
        database.insert(emailOutbox).values({
          ...baseEmail,
          attempts: 1,
          id: emailIds.queued,
          idempotencyKey: `constraint/${tenantId}`,
          status: 'sent',
        }),
      );
      yield* Effect.promise(() =>
        expect(
          database
            .update(emailOutbox)
            .set({ attempts: 2 })
            .where(eq(emailOutbox.id, emailIds.queued)),
        ).rejects.toMatchObject({
          cause: {
            code: '23514',
            constraint: 'email_outbox_single_dispatch_attempts_check',
          },
        }),
      );
      const rows = yield* Effect.promise(() =>
        database
          .select({
            attempts: emailOutbox.attempts,
            status: emailOutbox.status,
          })
          .from(emailOutbox)
          .where(eq(emailOutbox.id, emailIds.queued)),
      );
      expect(rows).toEqual([{ attempts: 1, status: 'sent' }]);
    }),
  );
});
