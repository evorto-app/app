import { describe, expect, layer } from '@effect/vitest';
import {
  createDefaultTenantDiscountProviders,
  DEFAULT_TENANT_RECEIPT_ALLOW_OTHER,
  DEFAULT_TENANT_RECEIPT_COUNTRIES,
} from '@shared/tenant-config';
import { Effect, Layer, Schema } from 'effect';
import * as Headers from 'effect/unstable/http/Headers';
import { Rpc, RpcMessage } from 'effect/unstable/rpc';

import {
  RpcRequestContext,
  RpcRequestContextMiddleware,
  type RpcRequestContextShape,
} from '../../../../../shared/rpc-contracts/app-rpcs/rpc-request-context.middleware';
import { PlatformAdministratorAuthority } from '../../../../../types/custom/platform-authority';
import { Tenant } from '../../../../../types/custom/tenant';
import { User } from '../../../../../types/custom/user';
import { rpcRequestContextMiddlewareLive } from './rpc-request-context.middleware.live';

const trustedContext = {
  authData: {
    email: 'alice@example.com',
    sub: 'auth0|abc',
  },
  authenticated: true,
  permissions: ['users:viewAll'],
  platformAuthority: Schema.decodeUnknownSync(PlatformAdministratorAuthority)({
    actorEmail: 'platform@example.org',
    actorId: 'auth0|platform-admin',
    kind: 'platformAdministrator',
  }),
  tenant: Schema.decodeUnknownSync(Tenant)({
    cancellationDeadlineHoursBeforeStart: 120,
    currency: 'EUR',
    defaultLocation: null,
    discountProviders: createDefaultTenantDiscountProviders(),
    domain: 'example.org',
    id: 'tenant-1',
    maxActiveRegistrationsPerUser: 0,
    name: 'Example Tenant',
    receiptSettings: {
      allowOther: DEFAULT_TENANT_RECEIPT_ALLOW_OTHER,
      receiptCountries: [...DEFAULT_TENANT_RECEIPT_COUNTRIES],
    },
    refundFeesOnCancellation: true,
    stripeAccountId: null,
    theme: 'evorto',
    timezone: 'Europe/Prague',
    transferDeadlineHoursBeforeStart: 0,
  }),
  user: Schema.decodeUnknownSync(User)({
    auth0Id: 'auth0|abc',
    communicationEmail: 'alice@example.com',
    email: 'alice@example.com',
    firstName: 'Alice',
    iban: null,
    id: 'user-1',
    lastName: 'Example',
    paypalEmail: null,
    permissions: ['users:viewAll'],
    roleIds: ['role-1'],
  }),
  userAssigned: true,
} satisfies RpcRequestContextShape;

const contextWithOmittedOptionalFields = {
  ...trustedContext,
  platformAuthority: null,
  tenant: Schema.decodeUnknownSync(Tenant)({
    cancellationDeadlineHoursBeforeStart: 120,
    currency: 'EUR',
    discountProviders: createDefaultTenantDiscountProviders(),
    domain: 'example.org',
    id: 'tenant-1',
    maxActiveRegistrationsPerUser: 0,
    name: 'Example Tenant',
    receiptSettings: {
      allowOther: DEFAULT_TENANT_RECEIPT_ALLOW_OTHER,
      receiptCountries: [...DEFAULT_TENANT_RECEIPT_COUNTRIES],
    },
    refundFeesOnCancellation: true,
    stripeAccountId: null,
    theme: 'evorto',
    timezone: 'Europe/Prague',
    transferDeadlineHoursBeforeStart: 0,
  }),
  user: Schema.decodeUnknownSync(User)({
    auth0Id: 'auth0|abc',
    communicationEmail: 'alice@example.com',
    email: 'alice@example.com',
    firstName: 'Alice',
    id: 'user-1',
    lastName: 'Example',
    permissions: ['users:viewAll'],
    roleIds: ['role-1'],
  }),
} satisfies RpcRequestContextShape;

const createMiddlewareOptions = (headers = Headers.empty) => ({
  client: new Rpc.ServerClient(1),
  headers,
  payload: undefined,
  requestId: RpcMessage.RequestId(1),
  rpc: Rpc.make('rpcRequestContextTest'),
});

describe('rpc-request-context.middleware', () => {
  layer(rpcRequestContextMiddlewareLive)((it) => {
    it.effect('defects when the trusted request context is absent', () =>
      Effect.gen(function* () {
        const middleware = yield* RpcRequestContextMiddleware;
        const exit = yield* middleware(
          Effect.die(new Error('Handler must not run without request context')),
          createMiddlewareOptions(),
        ).pipe(Effect.exit);

        expect(exit._tag).toBe('Failure');
        if (exit._tag === 'Failure') {
          const reason = exit.cause.reasons[0];
          expect(reason?._tag).toBe('Die');
          expect(
            reason?._tag === 'Die' && reason.defect instanceof Error
              ? reason.defect.message
              : undefined,
          ).toBe('RpcRequestContext missing at RPC boundary');
        }
      }),
    );

    it.layer(Layer.succeed(RpcRequestContext, trustedContext))(
      'with trusted request context',
      (it) => {
        it.effect(
          'uses supplied context despite contradictory request headers',
          () =>
            Effect.gen(function* () {
              const handlerCompleted = new Error(
                'Handler observed request context',
              );
              let observedContext: RpcRequestContextShape | undefined;
              const middleware = yield* RpcRequestContextMiddleware;
              const handler = Effect.gen(function* () {
                const context = yield* RpcRequestContext;
                observedContext = context;
                expect(context.authenticated).toBe(true);
                expect(context.userAssigned).toBe(true);
                expect(context.tenant.id).toBe('tenant-1');
                expect(context.user?.id).toBe('user-1');
                expect(context.permissions).toEqual(['users:viewAll']);
                expect(context.platformAuthority).toEqual(
                  expect.objectContaining({
                    actorId: 'auth0|platform-admin',
                    kind: 'platformAdministrator',
                  }),
                );
                expect(context.authData.sub).toBe('auth0|abc');
                return yield* Effect.die(handlerCompleted);
              });
              const exit = yield* middleware(
                handler,
                createMiddlewareOptions(
                  Headers.fromInput({
                    'x-evorto-authenticated': 'false',
                    'x-evorto-permissions': 'W10=',
                    'x-evorto-tenant': 'eyJpZCI6Im90aGVyLXRlbmFudCJ9',
                    'x-evorto-user-assigned': 'false',
                  }),
                ),
              ).pipe(Effect.exit);

              expect(exit._tag).toBe('Failure');
              if (exit._tag === 'Failure') {
                const reason = exit.cause.reasons[0];
                expect(reason?._tag).toBe('Die');
                expect(reason?._tag === 'Die' ? reason.defect : undefined).toBe(
                  handlerCompleted,
                );
              }
              expect(observedContext).toBe(trustedContext);
            }),
        );
      },
    );

    it.layer(
      Layer.succeed(RpcRequestContext, contextWithOmittedOptionalFields),
    )('with omitted optional user fields', (it) => {
      it.effect(
        'preserves the decoded optional fields in supplied context',
        () =>
          Effect.gen(function* () {
            const handlerCompleted = new Error(
              'Handler observed request context',
            );
            let observedContext: RpcRequestContextShape | undefined;
            const middleware = yield* RpcRequestContextMiddleware;
            const handler = Effect.gen(function* () {
              const context = yield* RpcRequestContext;
              observedContext = context;
              expect(context.user).toMatchObject({
                iban: undefined,
                id: 'user-1',
                paypalEmail: undefined,
              });
              return yield* Effect.die(handlerCompleted);
            });
            const exit = yield* middleware(
              handler,
              createMiddlewareOptions(),
            ).pipe(Effect.exit);

            expect(exit._tag).toBe('Failure');
            if (exit._tag === 'Failure') {
              const reason = exit.cause.reasons[0];
              expect(reason?._tag).toBe('Die');
              expect(reason?._tag === 'Die' ? reason.defect : undefined).toBe(
                handlerCompleted,
              );
            }
            expect(observedContext).toBe(contextWithOmittedOptionalFields);
          }),
      );
    });
  });
});
