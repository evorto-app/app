import type { GlobalAdminTenantRecord } from '@shared/rpc-contracts/app-rpcs/global-admin.rpcs';

export const globalAdminTenantRows = (tenant: GlobalAdminTenantRecord) => [
  { label: 'Primary domain', value: tenant.domain },
  { label: 'Tenant ID', monospace: true, value: tenant.id },
  { label: 'Theme', value: tenant.theme },
  { label: 'Locale', value: tenant.locale },
  { label: 'Currency', value: tenant.currency },
  { label: 'Timezone', value: tenant.timezone },
  {
    label: 'Stripe account',
    value: tenant.stripeConnected ? 'Connected' : 'Not connected',
  },
];
