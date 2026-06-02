import { describe, expect, it } from '@effect/vitest';
import { Effect, Layer } from 'effect';
import { vi } from 'vitest';

import { Database } from '../../../../../db';
import { eventInstances } from '../../../../../db/schema';
import {
  RpcRequestContext,
  type RpcRequestContextShape,
} from '../../../../../shared/rpc-contracts/app-rpcs';
import { RpcAccess } from '../shared/rpc-access.service';
import { eventReviewHandlers } from './events-review.handlers';

const baseTenant = {
  currency: 'EUR' as const,
  defaultLocation: null,
  discountProviders: {
    esnCard: {
      config: {},
      status: 'disabled' as const,
    },
  },
  domain: 'tenant.example.com',
  eventReviewPolicy: 'review_required' as const,
  id: 'tenant-1',
  locale: 'en-GB' as const,
  name: 'Tenant',
  receiptSettings: {
    allowOther: false,
    receiptCountries: ['NL'],
  },
  stripeAccountId: null,
  stripeAccountManagement: 'platform_managed' as const,
  theme: 'evorto' as const,
  timezone: 'Europe/Berlin' as const,
};

const user = {
  attributes: [],
  auth0Id: 'auth0|user-1',
  email: 'alice@example.com',
  firstName: 'Alice',
  iban: null,
  id: 'user-1',
  lastName: 'Doe',
  paypalEmail: null,
  permissions: ['events:create'],
  roleIds: [],
};

const requestContextLayer = (
  tenant: RpcRequestContextShape['tenant'] = baseTenant,
) =>
  Layer.mergeAll(
    RpcAccess.Default,
    Layer.succeed(RpcRequestContext, {
      authData: {},
      authenticated: true,
      permissions: ['events:create'],
      tenant,
      user,
      userAssigned: true,
    } satisfies RpcRequestContextShape),
  );

const makeSubmitDatabase = () => {
  const capturedSet = vi.fn();
  const updateQuery = {
    returning: vi.fn(() => Effect.succeed([{ id: 'event-1' }])),
    set: vi.fn((value: Record<string, unknown>) => {
      capturedSet(value);
      return updateQuery;
    }),
    where: vi.fn(() => updateQuery),
  };

  return {
    capturedSet,
    database: {
      query: {
        eventInstances: {
          findFirst: vi.fn(() =>
            Effect.succeed({
              creatorId: user.id,
              id: 'event-1',
              status: 'DRAFT' as const,
            }),
          ),
        },
      },
      update: vi.fn((table) => {
        expect(table).toBe(eventInstances);
        return updateQuery;
      }),
    },
  };
};

describe('eventReviewHandlers submitForReview tenant policy', () => {
  it.effect(
    'keeps submitted events pending when tenant review is required',
    () =>
      Effect.gen(function* () {
        const { capturedSet, database } = makeSubmitDatabase();

        yield* eventReviewHandlers['events.submitForReview'](
          { eventId: 'event-1' },
          { headers: {} } as never,
        ).pipe(
          Effect.provide(requestContextLayer()),
          Effect.provide(Layer.succeed(Database, database as never)),
        );

        expect(capturedSet).toHaveBeenCalledWith({
          reviewedAt: null,
          reviewedBy: null,
          status: 'PENDING_REVIEW',
          statusComment: null,
        });
      }),
  );

  it.effect(
    'approves submitted events when tenant organizers self-publish',
    () =>
      Effect.gen(function* () {
        const { capturedSet, database } = makeSubmitDatabase();

        yield* eventReviewHandlers['events.submitForReview'](
          { eventId: 'event-1' },
          { headers: {} } as never,
        ).pipe(
          Effect.provide(
            requestContextLayer({
              ...baseTenant,
              eventReviewPolicy: 'organizer_self_publish',
            }),
          ),
          Effect.provide(Layer.succeed(Database, database as never)),
        );

        expect(capturedSet).toHaveBeenCalledWith({
          reviewedAt: expect.any(Date),
          reviewedBy: user.id,
          status: 'APPROVED',
          statusComment: null,
        });
      }),
  );
});
