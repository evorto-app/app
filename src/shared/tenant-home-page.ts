import { Schema } from 'effect';

import { isWebUrl } from './web-url';

export const isTenantHomePageUrl = isWebUrl;

export const TenantHomePageUrl = Schema.String.check(
  Schema.makeFilter(isTenantHomePageUrl, {
    expected: 'an absolute HTTP or HTTPS address without credentials',
  }),
);
