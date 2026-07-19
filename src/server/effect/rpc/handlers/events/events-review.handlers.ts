import {
  RpcBadRequestError,
  RpcForbiddenError,
} from '@shared/errors/rpc-errors';
import {
  EventConflictError,
  EventNotFoundError,
} from '@shared/rpc-contracts/app-rpcs/events.errors';
import { and, eq } from 'drizzle-orm';
import { DateTime, Effect } from 'effect';

import type { AppRpcHandlers } from '../shared/handler-types';

import { Database } from '../../../../../db';
import { eventInstances } from '../../../../../db/schema';
import { ensureStripeForStoredEventConfiguration } from '../../../../payments/paid-event-configuration';
import { RpcAccess } from '../shared/rpc-access.service';
import { canEditEvent, databaseEffect } from './events.shared';

export type EventReviewDecision =
  | {
      status: 'APPROVED';
      statusComment: null | string;
    }
  | {
      status: 'DRAFT';
      statusComment: string;
    };

export const eventReviewDecision = ({
  approved,
  comment,
}: {
  approved: boolean;
  comment?: string | undefined;
}): EventReviewDecision | undefined => {
  const normalizedComment = comment?.trim() || undefined;
  if (approved) {
    return {
      status: 'APPROVED',
      statusComment: normalizedComment ?? null,
    };
  }

  if (!normalizedComment) {
    return;
  }

  return {
    status: 'DRAFT',
    statusComment: normalizedComment,
  };
};

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
      const decision = eventReviewDecision({ approved, comment });
      if (!decision) {
        return yield* Effect.fail(
          new RpcBadRequestError({
            message: 'Feedback is required when returning an event to draft',
            reason: 'reviewFeedbackRequired',
          }),
        );
      }
      const reviewedAt = yield* DateTime.nowAsDate;

      const reviewedEvents = yield* Database.use((database) =>
        database
          .transaction((transaction) =>
            Effect.gen(function* () {
              if (approved) {
                yield* ensureStripeForStoredEventConfiguration(
                  transaction,
                  tenant.id,
                  eventId,
                );
              }

              return yield* transaction
                .update(eventInstances)
                .set({
                  reviewedAt,
                  reviewedBy: user.id,
                  status: decision.status,
                  statusComment: decision.statusComment,
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
                });
            }),
          )
          .pipe(
            Effect.catch((error) =>
              error instanceof RpcBadRequestError
                ? Effect.fail(error)
                : Effect.die(error),
            ),
          ),
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
        return yield* Effect.fail(
          new EventNotFoundError({
            id: eventId,
            message: 'Event not found',
          }),
        );
      }

      return yield* Effect.fail(
        new EventConflictError({
          message: 'Event cannot be reviewed in its current state',
        }),
      );
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
        return yield* Effect.fail(
          new EventNotFoundError({
            id: eventId,
            message: 'Event not found',
          }),
        );
      }

      if (
        !canEditEvent({
          creatorId: event.creatorId,
          permissions: user.permissions,
          userId: user.id,
        })
      ) {
        return yield* Effect.fail(
          new RpcForbiddenError({ message: 'Forbidden' }),
        );
      }
      if (event.status !== 'DRAFT') {
        return yield* Effect.fail(
          new EventConflictError({
            message:
              'Event cannot be submitted for review in its current state',
          }),
        );
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
              eq(eventInstances.status, 'DRAFT'),
            ),
          )
          .returning({
            id: eventInstances.id,
          }),
      );
      if (submittedEvents.length > 0) {
        return;
      }

      return yield* Effect.fail(
        new EventConflictError({
          message: 'Event review submission preconditions failed',
        }),
      );
    }),
} satisfies Partial<AppRpcHandlers>;
