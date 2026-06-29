import type { GlobalAdminTenantRecord } from '@shared/rpc-contracts/app-rpcs/global-admin.rpcs';

import { getErrorMessage } from '../../core/error-message';

export const globalAdminTenantListErrorMessage = (error: unknown): string =>
  getErrorMessage(error, 'Failed to load tenants');

const searchableTenantFields = (tenant: GlobalAdminTenantRecord): string[] => [
  tenant.currency,
  tenant.domain,
  tenant.id,
  tenant.locale,
  tenant.name,
  tenant.theme,
  tenant.timezone,
  tenant.stripeConnected ? 'connected' : 'not connected',
];

export const filterGlobalAdminTenants = (
  tenants: readonly GlobalAdminTenantRecord[],
  search: string,
): GlobalAdminTenantRecord[] => {
  const normalizedSearch = search.trim().toLocaleLowerCase();
  if (!normalizedSearch) {
    return [...tenants];
  }

  return tenants.filter((tenant) =>
    searchableTenantFields(tenant).some((field) =>
      field.toLocaleLowerCase().includes(normalizedSearch),
    ),
  );
};

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
