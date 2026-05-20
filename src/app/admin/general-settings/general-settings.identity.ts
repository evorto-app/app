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

export const deferredTenantSettingsRows = [
  {
    label: 'Domain onboarding',
    value:
      'Custom-domain verification and multiple domains are not managed here yet.',
  },
  {
    label: 'Brand assets',
    value:
      'Logo and favicon URLs are editable below; file uploads are not implemented yet.',
  },
  {
    label: 'Legal pages',
    value:
      'Imprint, privacy, and terms links or hosted text are editable below.',
  },
  {
    label: 'Operations policy',
    value:
      'Email sender, review policy, registration limits, and Stripe account management are not implemented here yet.',
  },
] as const;
