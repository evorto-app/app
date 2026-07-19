import { type Permission } from '@shared/permissions/permissions';
import { Context } from 'effect';

import { type PlatformAdministratorAuthority } from '../../../../../types/custom/platform-authority';

export interface PlatformOperationContextShape {
  readonly allowedPermissions: readonly Permission[];
  readonly authority: PlatformAdministratorAuthority;
  readonly reason: null | string;
  readonly targetTenantId: string;
}

export class PlatformOperationContext extends Context.Service<
  PlatformOperationContext,
  PlatformOperationContextShape
>()('@server/effect/rpc/handlers/shared/PlatformOperationContext') {}
