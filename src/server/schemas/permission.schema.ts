import { Schema } from 'effect';

import { ALL_PERMISSION_VALUES, type Permission } from '../../shared/permissions/permissions';

export const PermissionSchema = Schema.declare(
  (input: unknown): input is Permission =>
    typeof input === 'string' && ALL_PERMISSION_VALUES.includes(input as Permission),
);
