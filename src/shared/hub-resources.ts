import { Schema } from 'effect';

import { Icons8IconName } from './rpc-contracts/app-rpcs/icons.rpcs';
import { isTenantFooterHref } from './tenant-footer-links';
import { iconSchema } from './types/icon';

export const MAX_HUB_RESOURCES = 30;
export const HubResource = Schema.Struct({
  href: Schema.String.check(
    Schema.makeFilter(isTenantFooterHref, {
      expected: 'an HTTP, HTTPS, or email link without credentials',
    }),
  ),
  icon: Schema.Struct({ ...iconSchema.fields, iconName: Icons8IconName }),
  label: Schema.String.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(80),
    Schema.makeFilter((value) => value === value.trim() && value.length > 0),
  ),
});
export type HubResource = Schema.Schema.Type<typeof HubResource>;
export const HubResources = Schema.Array(HubResource).check(
  Schema.isMaxLength(MAX_HUB_RESOURCES),
);
export class HubResourcesConflictError extends Schema.TaggedError<HubResourcesConflictError>()(
  'HubResourcesConflictError',
  { message: Schema.String },
) {}
