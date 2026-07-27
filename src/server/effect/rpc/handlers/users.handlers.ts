import {
  RpcBadRequestError,
  RpcUnauthorizedError,
} from '@shared/errors/rpc-errors';
import { isCanonicalIban } from '@shared/iban';
import { isCanonicalEmailAddress } from '@shared/notification-email';
import {
  UserRoleAssignmentNotFoundError,
  UserSelfRoleRemovalError,
} from '@shared/rpc-contracts/app-rpcs/users.errors';
import { and, count, eq, gte, ilike, inArray, lte } from 'drizzle-orm';
import { Effect } from 'effect';
import { DateTime } from 'luxon';

import type { AppRpcHandlers } from './shared/handler-types';

import { Database, type DatabaseClient } from '../../../../db';
import {
  eventInstances,
  eventRegistrationOptions,
  eventRegistrations,
  roles,
  rolesToTenantUsers,
  users,
  usersToTenants,
} from '../../../../db/schema';
import { includesPermission } from '../../../../shared/permissions/permissions';
import { type UsersEventSummaryRecord } from '../../../../shared/rpc-contracts/app-rpcs/users.rpcs';
import { isRegistrationEligibilityChangedAfterPaymentRefundOperationKey } from '../../../registrations/registration-eligibility';
import { lockTenantRoleGraph } from '../../../roles/tenant-role-graph';
import { RpcAccess } from './shared/rpc-access.service';

const databaseEffect = <A>(
  operation: (database: DatabaseClient) => Effect.Effect<A, unknown, never>,
): Effect.Effect<A, never, Database> =>
  Database.use((database) => operation(database).pipe(Effect.orDie));

export const normalizeUsersFindManySearch = (
  search: string | undefined,
): string | undefined => {
  const trimmed = search?.trim();
  const escaped = trimmed
    ?.replaceAll('\\', '\\\\')
    .replaceAll('%', String.raw`\%`)
    .replaceAll('_', String.raw`\_`);
  return escaped ? `%${escaped}%` : undefined;
};

const uniqueRoleIds = (roleIds: readonly string[]): string[] => [
  ...new Set(roleIds),
];

const missingRegistrationRelationDefect = (registration: {
  eventId: string;
  id: string;
}) =>
  new Error(
    `Registration ${registration.id} references missing event or registration option for event ${registration.eventId}`,
  );

const resolveRegistrationPaymentState = (
  transactions: readonly { status: string; type: string }[],
): 'cancelled' | 'notRequired' | 'pending' | 'recorded' => {
  const registrationTransactions = transactions.filter(
    (transaction) => transaction.type === 'registration',
  );
  if (
    registrationTransactions.some(
      (transaction) => transaction.status === 'pending',
    )
  ) {
    return 'pending';
  }
  if (
    registrationTransactions.some(
      (transaction) => transaction.status === 'successful',
    )
  ) {
    return 'recorded';
  }
  if (
    registrationTransactions.some(
      (transaction) => transaction.status === 'cancelled',
    )
  ) {
    return 'cancelled';
  }

  return 'notRequired';
};

const resolvePendingRegistrationCheckoutUrl = (
  transactions: readonly {
    method?: string;
    status: string;
    stripeCheckoutUrl?: null | string;
    type: string;
  }[],
): null | string =>
  transactions.find(
    (transaction) =>
      transaction.method === 'stripe' &&
      transaction.status === 'pending' &&
      transaction.type === 'registration' &&
      transaction.stripeCheckoutUrl,
  )?.stripeCheckoutUrl ?? null;

type ProfileRefundRecord = UsersEventSummaryRecord['refunds'][number];
type ProfileRefundState = ProfileRefundRecord['state'];

export const resolveProfileCancellationReason = (
  transactions: readonly {
    readonly refundOperationKey: null | string;
    readonly sourceTransactionId: null | string;
    readonly type: string;
  }[],
): UsersEventSummaryRecord['cancellationReason'] =>
  transactions.some(
    (transaction) =>
      transaction.type === 'refund' &&
      isRegistrationEligibilityChangedAfterPaymentRefundOperationKey(
        transaction.refundOperationKey,
        transaction.sourceTransactionId,
      ),
  )
    ? 'eligibilityChangedAfterPayment'
    : null;

export const resolveProfileRefundState = (refund: {
  readonly method: string;
  readonly status: string;
  readonly stripeRefundAttempts: number;
  readonly stripeRefundClaimLeaseExpiresAt: Date | null;
  readonly stripeRefundClaimLeaseId: null | string;
  readonly stripeRefundGeneration: number;
  readonly stripeRefundMaxAttempts: number;
  readonly stripeRefundNextAttemptAt: Date | null;
  readonly stripeRefundRequeuedAt: Date | null;
  readonly stripeRefundStatus: null | string;
}): ProfileRefundState => {
  if (
    refund.status === 'cancelled' ||
    refund.stripeRefundStatus === 'canceled' ||
    refund.stripeRefundStatus === 'failed'
  ) {
    return 'needsAttention';
  }

  if (
    refund.status === 'successful' ||
    refund.stripeRefundStatus === 'succeeded'
  ) {
    return 'succeeded';
  }

  if (
    refund.method === 'stripe' &&
    refund.status === 'pending' &&
    refund.stripeRefundStatus === 'requires_action'
  ) {
    return 'actionRequired';
  }

  if (refund.method === 'stripe' && refund.status === 'pending') {
    const leaseShapeValid =
      (refund.stripeRefundClaimLeaseId === null) ===
      (refund.stripeRefundClaimLeaseExpiresAt === null);
    if (!leaseShapeValid) {
      return 'needsAttention';
    }
    const activeLease =
      refund.stripeRefundClaimLeaseId !== null &&
      refund.stripeRefundClaimLeaseExpiresAt !== null;
    if (
      !activeLease &&
      (refund.stripeRefundAttempts >= refund.stripeRefundMaxAttempts ||
        refund.stripeRefundNextAttemptAt === null)
    ) {
      return 'needsAttention';
    }

    return refund.stripeRefundAttempts > 0 ||
      refund.stripeRefundGeneration > 0 ||
      refund.stripeRefundRequeuedAt !== null ||
      refund.stripeRefundClaimLeaseId !== null
      ? 'retrying'
      : 'pending';
  }

  return 'needsAttention';
};

const resolveProfileRefunds = (
  registrationTransactions: readonly {
    readonly amount: number;
    readonly currency: UsersEventSummaryRecord['refunds'][number]['currency'];
    readonly method: string;
    readonly sourceTransaction?: null | { readonly type: string };
    readonly status: string;
    readonly stripeRefundAttempts: number;
    readonly stripeRefundClaimLeaseExpiresAt: Date | null;
    readonly stripeRefundClaimLeaseId: null | string;
    readonly stripeRefundGeneration: number;
    readonly stripeRefundMaxAttempts: number;
    readonly stripeRefundNextAttemptAt: Date | null;
    readonly stripeRefundRequeuedAt: Date | null;
    readonly stripeRefundStatus: null | string;
    readonly type: string;
    readonly updatedAt: Date;
  }[],
): UsersEventSummaryRecord['refunds'] =>
  registrationTransactions
    .flatMap((transaction) => {
      if (transaction.type !== 'refund') return [];
      const source = transaction.sourceTransaction?.type;
      if (source !== 'addon' && source !== 'registration') {
        throw new Error(
          'Registration refund references an unsupported or missing payment source',
        );
      }

      return [
        {
          amount: Math.abs(transaction.amount),
          currency: transaction.currency,
          source,
          state: resolveProfileRefundState(transaction),
          updatedAt: transaction.updatedAt.toISOString(),
        } satisfies ProfileRefundRecord,
      ];
    })
    .toSorted(
      (left, right) =>
        left.updatedAt.localeCompare(right.updatedAt) ||
        left.source.localeCompare(right.source) ||
        left.amount - right.amount,
    );

export const tenantDayBounds = (timezone: string, now = DateTime.now()) => {
  const tenantNow = now.setZone(timezone);
  return {
    end: tenantNow.endOf('day').toJSDate(),
    start: tenantNow.startOf('day').toJSDate(),
  };
};

export const userHandlers = {
  'users.assignRoles': ({ roleIds, userId }, _options) =>
    Effect.gen(function* () {
      yield* RpcAccess.ensurePermission('users:assignRoles');
      const { tenant } = yield* RpcAccess.current();
      const currentUser = yield* RpcAccess.requireUser();
      const nextRoleIds = uniqueRoleIds(roleIds);

      yield* Database.use((database) =>
        database
          .transaction((tx) =>
            Effect.gen(function* () {
              yield* lockTenantRoleGraph(tx, tenant.id);
              const memberships = yield* tx
                .select({ id: usersToTenants.id })
                .from(usersToTenants)
                .where(
                  and(
                    eq(usersToTenants.tenantId, tenant.id),
                    eq(usersToTenants.userId, userId),
                  ),
                )
                .for('update');
              const membership = memberships[0];
              if (!membership) {
                return yield* Effect.fail(
                  new UserRoleAssignmentNotFoundError({
                    message: 'Tenant user not found',
                  }),
                );
              }

              if (userId === currentUser.id && nextRoleIds.length === 0) {
                return yield* Effect.fail(
                  new UserSelfRoleRemovalError({
                    message: 'You cannot remove all of your own roles',
                  }),
                );
              }

              if (nextRoleIds.length > 0) {
                const tenantRoles = yield* tx.query.roles.findMany({
                  columns: {
                    id: true,
                  },
                  where: {
                    id: { in: nextRoleIds },
                    tenantId: tenant.id,
                  },
                });
                if (tenantRoles.length !== nextRoleIds.length) {
                  return yield* Effect.fail(
                    new UserRoleAssignmentNotFoundError({
                      message: 'One or more roles were not found',
                    }),
                  );
                }
              }

              yield* tx
                .delete(rolesToTenantUsers)
                .where(
                  and(
                    eq(rolesToTenantUsers.tenantId, tenant.id),
                    eq(rolesToTenantUsers.userTenantId, membership.id),
                  ),
                );

              if (nextRoleIds.length > 0) {
                yield* tx.insert(rolesToTenantUsers).values(
                  nextRoleIds.map((roleId) => ({
                    roleId,
                    tenantId: tenant.id,
                    userTenantId: membership.id,
                  })),
                );
              }
            }),
          )
          .pipe(
            Effect.catch((error) =>
              error instanceof UserRoleAssignmentNotFoundError ||
              error instanceof UserSelfRoleRemovalError
                ? Effect.fail(error)
                : Effect.die(error),
            ),
          ),
      );
    }),
  'users.authData': (_payload, _options) =>
    RpcAccess.current().pipe(Effect.map((context) => context.authData)),
  'users.canUseScanner': (_payload, _options) =>
    Effect.gen(function* () {
      const context = yield* RpcAccess.current();
      if (!context.authenticated) {
        return false;
      }

      const { tenant, user } = context;
      if (!user) {
        return false;
      }
      if (includesPermission('events:organizeAll', user.permissions)) {
        return true;
      }

      const { end, start } = tenantDayBounds(tenant.timezone);
      const organizingRegistrations = yield* databaseEffect((database) =>
        database
          .select({
            id: eventRegistrations.id,
          })
          .from(eventRegistrations)
          .innerJoin(
            eventRegistrationOptions,
            eq(
              eventRegistrationOptions.id,
              eventRegistrations.registrationOptionId,
            ),
          )
          .innerJoin(
            eventInstances,
            eq(eventInstances.id, eventRegistrations.eventId),
          )
          .where(
            and(
              eq(eventRegistrations.status, 'CONFIRMED'),
              eq(eventRegistrations.tenantId, tenant.id),
              eq(eventRegistrations.userId, user.id),
              eq(eventRegistrationOptions.organizingRegistration, true),
              lte(eventInstances.start, end),
              gte(eventInstances.end, start),
            ),
          )
          .limit(1),
      );

      return organizingRegistrations.length > 0;
    }),
  'users.events': (_payload, _options) =>
    Effect.gen(function* () {
      yield* RpcAccess.ensureAuthenticated();
      const { tenant } = yield* RpcAccess.current();
      const user = yield* RpcAccess.requireUser();

      const refundRegistrationRows = yield* databaseEffect((database) =>
        database.query.transactions.findMany({
          columns: { eventRegistrationId: true },
          where: {
            targetUserId: user.id,
            tenantId: tenant.id,
            type: 'refund',
          },
        }),
      );
      const cancelledRegistrationIds = [
        ...new Set(
          refundRegistrationRows.flatMap(({ eventRegistrationId }) =>
            eventRegistrationId ? [eventRegistrationId] : [],
          ),
        ),
      ];

      const registrations = yield* databaseEffect((database) =>
        database.query.eventRegistrations.findMany({
          columns: {
            checkInTime: true,
            eventId: true,
            guestCount: true,
            id: true,
            status: true,
          },
          where: {
            ...(cancelledRegistrationIds.length === 0
              ? { status: { NOT: 'CANCELLED' as const } }
              : {
                  OR: [
                    { status: { NOT: 'CANCELLED' as const } },
                    {
                      id: { in: cancelledRegistrationIds },
                      status: 'CANCELLED' as const,
                    },
                  ],
                }),
            tenantId: tenant.id,
            userId: user.id,
          },
          with: {
            addonPurchases: {
              columns: {
                purchasedQuantity: true,
                quantity: true,
                unitPrice: true,
              },
              with: {
                addOn: {
                  columns: {
                    title: true,
                  },
                },
              },
            },
            event: {
              columns: {
                description: true,
                end: true,
                id: true,
                start: true,
                title: true,
              },
            },
            registrationOption: {
              columns: {
                organizingRegistration: true,
                title: true,
              },
            },
            transactions: {
              columns: {
                amount: true,
                currency: true,
                method: true,
                refundOperationKey: true,
                sourceTransactionId: true,
                status: true,
                stripeCheckoutUrl: true,
                stripeRefundAttempts: true,
                stripeRefundClaimLeaseExpiresAt: true,
                stripeRefundClaimLeaseId: true,
                stripeRefundGeneration: true,
                stripeRefundMaxAttempts: true,
                stripeRefundNextAttemptAt: true,
                stripeRefundRequeuedAt: true,
                stripeRefundStatus: true,
                type: true,
                updatedAt: true,
              },
              where: {
                targetUserId: user.id,
              },
              with: {
                sourceTransaction: {
                  columns: { type: true },
                },
              },
            },
          },
        }),
      );

      if (registrations.length === 0) {
        return [];
      }

      const mappedRegistrations = [];
      for (const registration of registrations) {
        if (!registration.event || !registration.registrationOption) {
          return yield* Effect.die(
            missingRegistrationRelationDefect(registration),
          );
        }
        mappedRegistrations.push({
          addonPurchases: registration.addonPurchases.flatMap((purchase) =>
            purchase.addOn
              ? [
                  {
                    currency: tenant.currency,
                    purchasedQuantity: purchase.purchasedQuantity,
                    quantity: purchase.quantity,
                    title: purchase.addOn.title,
                    unitPrice: purchase.unitPrice,
                  },
                ]
              : [],
          ),
          cancellationReason:
            registration.status === 'CANCELLED'
              ? resolveProfileCancellationReason(registration.transactions)
              : null,
          checkInTime: registration.checkInTime,
          checkoutUrl: resolvePendingRegistrationCheckoutUrl(
            registration.transactions,
          ),
          event: registration.event,
          guestCount: registration.guestCount,
          organizingRegistration:
            registration.registrationOption.organizingRegistration,
          paymentState: resolveRegistrationPaymentState(
            registration.transactions,
          ),
          refunds:
            registration.status === 'CANCELLED'
              ? resolveProfileRefunds(registration.transactions)
              : [],
          registrationId: registration.id,
          registrationOptionTitle: registration.registrationOption.title,
          status: registration.status,
        });
      }

      return mappedRegistrations
        .toSorted(
          (registrationA, registrationB) =>
            registrationA.event.start.getTime() -
            registrationB.event.start.getTime(),
        )
        .map((registration) => ({
          addonPurchases: registration.addonPurchases,
          cancellationReason: registration.cancellationReason,
          checkInTime: registration.checkInTime?.toISOString() ?? null,
          checkoutUrl: registration.checkoutUrl,
          description: registration.event.description ?? null,
          end: registration.event.end.toISOString(),
          eventId: registration.event.id,
          guestCount: registration.guestCount,
          organizingRegistration: registration.organizingRegistration,
          paymentState: registration.paymentState,
          refunds: registration.refunds,
          registrationId: registration.registrationId,
          registrationOptionTitle: registration.registrationOptionTitle,
          start: registration.event.start.toISOString(),
          status: registration.status,
          title: registration.event.title,
        }));
    }),
  'users.findMany': (input, _options) =>
    Effect.gen(function* () {
      yield* RpcAccess.ensurePermission('users:viewAll');
      const { tenant } = yield* RpcAccess.current();
      const search = normalizeUsersFindManySearch(input.search);
      const usersFilter = search
        ? and(
            eq(usersToTenants.tenantId, tenant.id),
            ilike(users.searchableInfo, search),
          )
        : eq(usersToTenants.tenantId, tenant.id);

      const usersCountResult = yield* databaseEffect((database) =>
        database
          .select({ count: count() })
          .from(usersToTenants)
          .innerJoin(users, eq(usersToTenants.userId, users.id))
          .where(usersFilter),
      );
      const usersCount = usersCountResult[0]?.count ?? 0;

      const tenantUserPage = yield* databaseEffect((database) =>
        database
          .select({
            email: users.email,
            firstName: users.firstName,
            id: users.id,
            lastName: users.lastName,
            userTenantId: usersToTenants.id,
          })
          .from(usersToTenants)
          .innerJoin(users, eq(usersToTenants.userId, users.id))
          .where(usersFilter)
          .orderBy(users.lastName, users.firstName)
          .offset(input.offset ?? 0)
          .limit(input.limit ?? 100),
      );

      if (tenantUserPage.length === 0) {
        return { users: [], usersCount };
      }

      const tenantUserIds = tenantUserPage.map((user) => user.userTenantId);
      const selectedRoles = yield* databaseEffect((database) =>
        database
          .select({
            role: roles.name,
            roleId: roles.id,
            userTenantId: usersToTenants.id,
          })
          .from(usersToTenants)
          .leftJoin(
            rolesToTenantUsers,
            eq(usersToTenants.id, rolesToTenantUsers.userTenantId),
          )
          .leftJoin(
            roles,
            and(
              eq(rolesToTenantUsers.roleId, roles.id),
              eq(roles.tenantId, tenant.id),
            ),
          )
          .where(inArray(usersToTenants.id, tenantUserIds)),
      );

      const userMap: Record<
        string,
        {
          email: string;
          firstName: string;
          id: string;
          lastName: string;
          roleIds: string[];
          roles: string[];
        }
      > = {};
      for (const user of tenantUserPage) {
        userMap[user.id] = {
          email: user.email,
          firstName: user.firstName,
          id: user.id,
          lastName: user.lastName,
          roleIds: [],
          roles: [],
        };
      }
      const userIdByTenantUserId = new Map(
        tenantUserPage.map((user) => [user.userTenantId, user.id]),
      );
      for (const selectedRole of selectedRoles) {
        const userId = userIdByTenantUserId.get(selectedRole.userTenantId);
        if (userId && selectedRole.role && selectedRole.roleId) {
          userMap[userId].roleIds.push(selectedRole.roleId);
          userMap[userId].roles.push(selectedRole.role);
        }
      }

      return { users: Object.values(userMap), usersCount };
    }),
  'users.maybeSelf': (_payload, _options) =>
    RpcAccess.current().pipe(Effect.map((context) => context.user)),
  'users.self': (_payload, _options) =>
    Effect.gen(function* () {
      yield* RpcAccess.ensureAuthenticated();
      return yield* RpcAccess.requireUser();
    }),
  'users.setHomeTenant': (_payload, _options) =>
    Effect.gen(function* () {
      yield* RpcAccess.ensureAuthenticated();
      const { tenant } = yield* RpcAccess.current();
      const user = yield* RpcAccess.requireUser();

      yield* Database.use((database) =>
        database
          .transaction((tx) =>
            Effect.gen(function* () {
              const memberships = yield* tx
                .select({ id: usersToTenants.id })
                .from(usersToTenants)
                .where(
                  and(
                    eq(usersToTenants.tenantId, tenant.id),
                    eq(usersToTenants.userId, user.id),
                  ),
                )
                .limit(1)
                .for('update');
              if (memberships.length === 0) {
                return yield* Effect.fail(
                  new RpcUnauthorizedError({
                    message: 'Current tenant membership required',
                  }),
                );
              }
              yield* tx
                .update(users)
                .set({ homeTenantId: tenant.id })
                .where(eq(users.id, user.id));
            }),
          )
          .pipe(
            Effect.catch((error) =>
              error instanceof RpcUnauthorizedError
                ? Effect.fail(error)
                : Effect.die(error),
            ),
          ),
      );

      return { homeTenantId: tenant.id, homeTenantName: tenant.name };
    }),
  'users.updateProfile': (input, _options) =>
    Effect.gen(function* () {
      yield* RpcAccess.ensureAuthenticated();
      const user = yield* RpcAccess.requireUser();

      if (!isCanonicalEmailAddress(input.communicationEmail)) {
        return yield* new RpcBadRequestError({
          message: 'Notification email must be a valid canonical email address',
          reason: 'invalidCommunicationEmail',
        });
      }
      if (
        input.iban !== null &&
        input.iban !== undefined &&
        !isCanonicalIban(input.iban)
      ) {
        return yield* new RpcBadRequestError({
          message: 'IBAN must have a valid country, length, and checksum',
          reason: 'invalidIban',
        });
      }
      if (
        input.paypalEmail !== null &&
        input.paypalEmail !== undefined &&
        !isCanonicalEmailAddress(input.paypalEmail)
      ) {
        return yield* new RpcBadRequestError({
          message: 'PayPal email must be a valid canonical email address',
          reason: 'invalidPaypalEmail',
        });
      }

      yield* databaseEffect((database) =>
        database
          .update(users)
          .set({
            communicationEmail: input.communicationEmail,
            firstName: input.firstName,
            iban: input.iban ?? null,
            lastName: input.lastName,
            paypalEmail: input.paypalEmail ?? null,
          })
          .where(eq(users.id, user.id)),
      );
    }),
  'users.userAssigned': (_payload, _options) =>
    RpcAccess.current().pipe(Effect.map((context) => context.userAssigned)),
} satisfies Partial<AppRpcHandlers>;
