export interface TenantIdentity {
  currency: string;
  domain: string;
  locale: string;
  name: string;
  stripeAccountId?: null | string | undefined;
  timezone: string;
}

export const tenantIdentityRows = (tenant: TenantIdentity) => [
  { label: 'Tenant name', value: tenant.name },
  { label: 'Primary domain', value: tenant.domain },
  { label: 'Currency', value: tenant.currency },
  { label: 'Locale', value: tenant.locale },
  { label: 'Timezone', value: tenant.timezone },
  {
    label: 'Stripe account',
    value: tenant.stripeAccountId ? 'Connected' : 'Not connected',
  },
];
