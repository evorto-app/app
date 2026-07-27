import type { Tenant } from '../../../types/custom/tenant';

export type TenantIdentity = Pick<Tenant, 'domain' | 'name'>;

export const tenantIdentityRows = (tenant: TenantIdentity) => [
  { label: 'Organization name', value: tenant.name },
  { label: 'Public domain', value: tenant.domain },
];
