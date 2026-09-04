import { EffectDrizzleQueryError } from 'drizzle-orm/effect-core';
import { Cause, Effect } from 'effect';
import { isSqlError, type SqlError } from 'effect/unstable/sql/SqlError';

import { roleTenantNameUniqueConstraintName } from '../../db/schema';
import {
  partitionTenantRolePermissions,
  type Permission,
  type TenantRolePermission,
} from '../../shared/permissions/permissions';
import {
  ROLE_DESCRIPTION_MAX_LENGTH,
  ROLE_NAME_MAX_LENGTH,
  RoleNameAlreadyExistsError,
  RoleWriteValidationError,
} from '../../shared/rpc-contracts/app-rpcs/role-write.shared';

export interface NormalizedRoleWrite {
  readonly defaultOrganizerRole: boolean;
  readonly defaultUserRole: boolean;
  readonly description: null | string;
  readonly displayInHub: boolean;
  readonly name: string;
  readonly permissions: TenantRolePermission[];
}

export interface RoleWriteSource {
  readonly defaultOrganizerRole: boolean;
  readonly defaultUserRole: boolean;
  readonly description: null | string;
  readonly displayInHub: boolean;
  readonly name: string;
  readonly permissions: readonly Permission[];
}

const validationError = (
  field: 'description' | 'name' | 'permissions',
  message: string,
) => RoleWriteValidationError.make({ field, message });

export const normalizeRoleWrite = Effect.fn('RoleWrite.normalize')(function* (
  input: RoleWriteSource,
) {
  const name = input.name.trim();
  if (!name) {
    return yield* validationError('name', 'Role name is required');
  }
  if (name.length > ROLE_NAME_MAX_LENGTH) {
    return yield* validationError(
      'name',
      `Role name must be ${ROLE_NAME_MAX_LENGTH} characters or fewer`,
    );
  }

  const description = input.description?.trim() || null;
  if (
    description !== null &&
    description.length > ROLE_DESCRIPTION_MAX_LENGTH
  ) {
    return yield* validationError(
      'description',
      `Role description must be ${ROLE_DESCRIPTION_MAX_LENGTH} characters or fewer`,
    );
  }

  const partitionedPermissions = partitionTenantRolePermissions(
    input.permissions,
  );
  if (partitionedPermissions.rejected.length > 0) {
    return yield* validationError(
      'permissions',
      'Permissions reserved for Evorto administrators cannot be added to an organization role.',
    );
  }

  return {
    defaultOrganizerRole: input.defaultOrganizerRole,
    defaultUserRole: input.defaultUserRole,
    description,
    displayInHub: input.displayInHub,
    name,
    permissions: [...new Set(partitionedPermissions.accepted)].toSorted(),
  } satisfies NormalizedRoleWrite;
});

const findSqlError = (error: unknown): SqlError | undefined => {
  if (isSqlError(error)) {
    return error;
  }
  if (
    !(error instanceof EffectDrizzleQueryError) ||
    !Cause.isCause(error.cause)
  ) {
    return;
  }

  for (const reason of error.cause.reasons) {
    if (Cause.isFailReason(reason) && isSqlError(reason.error)) {
      return reason.error;
    }
  }
  return;
};

export const roleNameConflictFromDatabase = (
  error: unknown,
  name: string,
): RoleNameAlreadyExistsError | undefined => {
  const sqlError = findSqlError(error);
  if (
    sqlError?.reason._tag !== 'UniqueViolation' ||
    sqlError.reason.constraint !== roleTenantNameUniqueConstraintName
  ) {
    return;
  }

  return RoleNameAlreadyExistsError.make({
    message: `A role named ${name} already exists`,
    name,
  });
};
