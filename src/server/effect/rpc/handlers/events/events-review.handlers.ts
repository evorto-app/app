import { and, eq, inArray } from 'drizzle-orm';
import { Effect } from 'effect';

import type { AppRpcHandlers } from '../shared/handler-types';

import { eventInstances } from '../../../../../db/schema';
import { RpcAccess } from '../shared/rpc-access.service';
import { canEditEvent, databaseEffect } from './events.shared';

export const eventReviewHandlers = {
'events.getPendingReviews': (_payload, _options) =>
      Effect.gen(function* () {
        yield* RpcAccess.ensurePermission('events:review');
        const { tenant } = yield* RpcAccess.current();

        const pendingReviews = yield* databaseEffect((database) =>
          database.query.eventInstances.findMany({
            columns: {
              id: true,
              start: true,
              title: true,
            },
            orderBy: { start: 'desc' },
            where: { status: 'PENDING_REVIEW', tenantId: tenant.id },
          }),
        );

        return pendingReviews.map((event) => ({
          id: event.id,
          start: event.start.toISOString(),
          title: event.title,
        }));
      }),
'events.reviewEvent': ({ approved, comment, eventId }, _options) =>
      Effect.gen(function* () {
        yield* RpcAccess.ensurePermission('events:review');
        const { tenant } = yield* RpcAccess.current();
        const user = yield* RpcAccess.requireUser();

        const reviewedEvents = yield* databaseEffect((database) =>
          database
            .update(eventInstances)
            .set({
              reviewedAt: new Date(),
              reviewedBy: user.id,
              status: approved ? 'APPROVED' : 'REJECTED',
              statusComment: comment || null,
            })
            .where(
              and(
                eq(eventInstances.id, eventId),
                eq(eventInstances.tenantId, tenant.id),
                eq(eventInstances.status, 'PENDING_REVIEW'),
              ),
            )
            .returning({
              id: eventInstances.id,
            }),
        );
        if (reviewedEvents.length > 0) {
          return;
        }

        const event = yield* databaseEffect((database) =>
          database.query.eventInstances.findFirst({
            columns: { id: true },
            where: {
              id: eventId,
              tenantId: tenant.id,
            },
          }),
        );
        if (!event) {
          return yield* Effect.fail('NOT_FOUND' as const);
        }

        return yield* Effect.fail('CONFLICT' as const);
      }),
'events.submitForReview': ({ eventId }, _options) =>
      Effect.gen(function* () {
        yield* RpcAccess.ensureAuthenticated();
        const { tenant } = yield* RpcAccess.current();
        const user = yield* RpcAccess.requireUser();

        const event = yield* databaseEffect((database) =>
          database.query.eventInstances.findFirst({
            columns: {
              creatorId: true,
              id: true,
              status: true,
            },
            where: {
              id: eventId,
              tenantId: tenant.id,
            },
          }),
        );
        if (!event) {
          return yield* Effect.fail('NOT_FOUND' as const);
        }

        if (
          !canEditEvent({
            creatorId: event.creatorId,
            permissions: user.permissions,
            userId: user.id,
          })
        ) {
          return yield* Effect.fail('FORBIDDEN' as const);
        }
        if (event.status !== 'DRAFT' && event.status !== 'REJECTED') {
          return yield* Effect.fail('CONFLICT' as const);
        }

        const submittedEvents = yield* databaseEffect((database) =>
          database
            .update(eventInstances)
            .set({
              reviewedAt: null,
              reviewedBy: null,
              status: 'PENDING_REVIEW',
              statusComment: null,
            })
            .where(
              and(
                eq(eventInstances.id, eventId),
                eq(eventInstances.tenantId, tenant.id),
                inArray(eventInstances.status, ['DRAFT', 'REJECTED']),
              ),
            )
            .returning({
              id: eventInstances.id,
            }),
        );
        if (submittedEvents.length > 0) {
          return;
        }

        return yield* Effect.fail('CONFLICT' as const);
      }),
} satisfies Partial<AppRpcHandlers>;
