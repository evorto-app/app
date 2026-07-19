import {
  RpcBadRequestError,
  RpcForbiddenError,
  RpcUnauthorizedError,
} from '@shared/errors/rpc-errors';
import { type Permission } from '@shared/permissions/permissions';
import {
  type PlatformAuditSnapshot,
  type PlatformTenantAuditAction,
} from '@shared/platform-audit';
import {
  RpcRequestContext,
  type RpcRequestContextShape,
} from '@shared/rpc-contracts/app-rpcs';
import { Effect, Schema } from 'effect';

import { Database, type DatabaseClient } from '../../../../../db';
import { platformAuditEntries } from '../../../../../db/schema';
import { type PlatformAdministratorAuthority } from '../../../../../types/custom/platform-authority';
import { Tenant } from '../../../../../types/custom/tenant';
import { PlatformOperationContext } from './platform-operation-context';
import { RpcAccess } from './rpc-access.service';

export interface ResolvedPlatformOperation {
  readonly authority: PlatformAdministratorAuthority;
  readonly reason: null | string;
  readonly requestContext: RpcRequestContextShape;
  readonly targetTenant: Tenant;
}

const normalizeReason = (
  reason: string,
): Effect.Effect<string, RpcBadRequestError> =>
  Effect.try({
    catch: () =>
      new RpcBadRequestError({
        message: 'A reason is required for platform changes',
      }),
    try: () => {
      const normalizedReason = reason.trim();
      if (!normalizedReason || normalizedReason.length > 500) {
        throw new Error('Invalid platform operation reason');
      }

      return normalizedReason;
    },
  });

const resolvePlatformOperation = Effect.fn(
  'PlatformOperation.resolvePlatformOperation',
)(function* (input: {
  reason: null | string;
  targetTenantId: string;
}): Effect.fn.Return<
  ResolvedPlatformOperation,
  RpcBadRequestError | RpcForbiddenError | RpcUnauthorizedError,
  Database | RpcAccess
> {
  const requestContext = yield* RpcAccess.current();
  if (!requestContext.authenticated) {
    return yield* new RpcUnauthorizedError({
      message: 'Authentication required',
    });
  }

  const authority = requestContext.platformAuthority;
  if (!authority) {
    return yield* new RpcForbiddenError({
      message: 'Platform administrator authority required',
    });
  }

  const targetTenantRecord = yield* Database.use((database) =>
    database.query.tenants
      .findFirst({
        where: { id: input.targetTenantId },
      })
      .pipe(Effect.orDie),
  );
  if (!targetTenantRecord) {
    return yield* new RpcBadRequestError({
      message: 'Target tenant not found',
    });
  }

  const targetTenant = yield* Schema.decodeUnknownEffect(Tenant)(
    targetTenantRecord,
  ).pipe(Effect.orDie);
  const reason =
    input.reason === null ? null : yield* normalizeReason(input.reason);

  return {
    authority,
    reason,
    requestContext: {
      ...requestContext,
      permissions: [],
      platformAuthority: authority,
      tenant: targetTenant,
      user: null,
      userAssigned: false,
    },
    targetTenant,
  };
});

export const resolvePlatformRead = Effect.fn(
  'PlatformOperation.resolvePlatformRead',
)(function* (targetTenantId: string) {
  return yield* resolvePlatformOperation({ reason: null, targetTenantId });
});

export const resolvePlatformMutation = Effect.fn(
  'PlatformOperation.resolvePlatformMutation',
)(function* (input: { reason: string; targetTenantId: string }) {
  return yield* resolvePlatformOperation(input);
});

export const providePlatformOperation = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  operation: ResolvedPlatformOperation,
  allowedPermissions: readonly Permission[],
) =>
  effect.pipe(
    Effect.provideService(RpcRequestContext, operation.requestContext),
    Effect.provideService(
      PlatformOperationContext,
      PlatformOperationContext.of({
        allowedPermissions,
        authority: operation.authority,
        reason: operation.reason,
        targetTenantId: operation.targetTenant.id,
      }),
    ),
  );

export const writePlatformAudit = Effect.fn(
  'PlatformOperation.writePlatformAudit',
)(function* (
  database: Pick<DatabaseClient, 'insert'>,
  input: {
    action: PlatformTenantAuditAction;
    after: null | PlatformAuditSnapshot;
    before: null | PlatformAuditSnapshot;
  },
) {
  const operation = yield* PlatformOperationContext;
  if (operation.reason === null) {
    return yield* Effect.die(
      new Error('Platform mutations require an audit reason'),
    );
  }
  if (input.before === null && input.after === null) {
    return yield* Effect.die(
      new Error('Platform audit entries require a before or after snapshot'),
    );
  }

  yield* database.insert(platformAuditEntries).values({
    action: input.action,
    actorEmail: operation.authority.actorEmail,
    actorId: operation.authority.actorId,
    after: input.after,
    before: input.before,
    reason: operation.reason,
    targetTenantId: operation.targetTenantId,
  });
});
