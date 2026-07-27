import type { DatabaseClient } from '@db/index';

import {
  eventInstances,
  eventRegistrationOptions,
  rolesToTenantUsers,
  usersToTenants,
} from '@db/schema';
import { and, eq } from 'drizzle-orm';
import { Effect } from 'effect';

const registrationEligibilityCompensationRefundOperationKeyPrefix =
  'registration-eligibility-compensation:';

export const registrationEligibilityCompensationRefundOperationKey = (
  sourceTransactionId: string,
): string =>
  `${registrationEligibilityCompensationRefundOperationKeyPrefix}${sourceTransactionId}`;

export const isRegistrationEligibilityChangedAfterPaymentRefundOperationKey = (
  value: null | string,
  sourceTransactionId: null | string,
): boolean =>
  sourceTransactionId !== null &&
  sourceTransactionId.length > 0 &&
  value ===
    registrationEligibilityCompensationRefundOperationKey(sourceTransactionId);

export const isUserEligibleForRegistrationOption = ({
  optionRoleIds,
  userRoleIds,
}: {
  optionRoleIds: readonly string[];
  userRoleIds: readonly string[];
}): boolean =>
  optionRoleIds.length === 0 ||
  optionRoleIds.some((roleId) => userRoleIds.includes(roleId));

export type LockedRegistrationEligibility =
  | {
      readonly _tag: 'Current';
      readonly closeRegistrationTime: Date;
      readonly eventStatus: typeof eventInstances.$inferSelect.status;
      readonly openRegistrationTime: Date;
      readonly organizingRegistration: boolean;
      readonly registrationMode: typeof eventRegistrationOptions.$inferSelect.registrationMode;
      readonly roleIds: readonly string[];
      readonly userRoleIds: readonly string[];
    }
  | { readonly _tag: 'NotMember' }
  | { readonly _tag: 'Unavailable' };

export const lockCurrentRegistrationEligibility = Effect.fn(
  'lockCurrentRegistrationEligibility',
)(function* (
  tx: Pick<DatabaseClient, 'select'>,
  input: {
    readonly eventId: string;
    readonly registrationOptionId: string;
    readonly tenantId: string;
    readonly userId: string;
  },
) {
  const memberships = yield* tx
    .select({ id: usersToTenants.id })
    .from(usersToTenants)
    .where(
      and(
        eq(usersToTenants.tenantId, input.tenantId),
        eq(usersToTenants.userId, input.userId),
      ),
    )
    .for('update');
  const membership = memberships[0];
  if (memberships.length !== 1 || !membership) {
    return {
      _tag: 'NotMember' as const,
    } satisfies LockedRegistrationEligibility;
  }

  // Role assignment writers serialize on the membership row before replacing
  // assignments, so reading the roles after that lock observes the current set.
  const roleAssignments = yield* tx
    .select({ roleId: rolesToTenantUsers.roleId })
    .from(rolesToTenantUsers)
    .where(
      and(
        eq(rolesToTenantUsers.tenantId, input.tenantId),
        eq(rolesToTenantUsers.userTenantId, membership.id),
      ),
    )
    .for('update');
  const options = yield* tx
    .select({
      closeRegistrationTime: eventRegistrationOptions.closeRegistrationTime,
      eventStatus: eventInstances.status,
      openRegistrationTime: eventRegistrationOptions.openRegistrationTime,
      organizingRegistration: eventRegistrationOptions.organizingRegistration,
      registrationMode: eventRegistrationOptions.registrationMode,
      roleIds: eventRegistrationOptions.roleIds,
    })
    .from(eventRegistrationOptions)
    .innerJoin(
      eventInstances,
      and(
        eq(eventInstances.id, eventRegistrationOptions.eventId),
        eq(eventInstances.tenantId, input.tenantId),
      ),
    )
    .where(
      and(
        eq(eventRegistrationOptions.id, input.registrationOptionId),
        eq(eventRegistrationOptions.eventId, input.eventId),
      ),
    )
    .for('update');
  const option = options[0];
  if (!option) {
    return {
      _tag: 'Unavailable' as const,
    } satisfies LockedRegistrationEligibility;
  }

  return {
    _tag: 'Current' as const,
    ...option,
    userRoleIds: roleAssignments.map((assignment) => assignment.roleId),
  } satisfies LockedRegistrationEligibility;
});
