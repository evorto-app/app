import {
  type Tenant,
  TENANT_FORMATTING_LOCALE,
} from '../../../types/custom/tenant';

export type TenantIdentity = Pick<
  Tenant,
  'currency' | 'domain' | 'name' | 'stripeAccountId' | 'timezone'
>;

export const tenantIdentityRows = (tenant: TenantIdentity) => [
  { label: 'Tenant name', value: tenant.name },
  { label: 'Primary domain', value: tenant.domain },
  { label: 'Currency', value: tenant.currency },
  { label: 'Formatting locale', value: TENANT_FORMATTING_LOCALE },
  { label: 'Timezone', value: tenant.timezone },
  {
    label: 'Stripe account',
    value: tenant.stripeAccountId
      ? `Connected (${tenant.stripeAccountId})`
      : 'Not connected',
  },
];

export const deferredTenantSettingsRows = [
  {
    label: 'Domain onboarding',
    value:
      'Custom-domain verification and multiple domains are not managed here yet.',
  },
] as const;
