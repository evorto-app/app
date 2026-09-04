import type { GlobalAdminTenantRecord } from '@shared/rpc-contracts/app-rpcs/global-admin.rpcs';

import { getErrorMessage } from '../../core/error-message';

export const globalAdminTenantListErrorMessage = (error: unknown): string =>
  getErrorMessage(error, 'Failed to load organizations');

const searchableTenantFields = (tenant: GlobalAdminTenantRecord): string[] => [
  tenant.currency,
  tenant.domain,
  tenant.name,
  tenant.theme,
  tenant.timezone,
  tenant.paymentsConfigured
    ? 'paid sign-ups ready'
    : 'paid sign-ups need attention',
];

export const globalAdminStripeAccountLabel = (
  tenant: Pick<GlobalAdminTenantRecord, 'paymentsConfigured'>,
): string => {
  if (!tenant.paymentsConfigured) {
    return 'Paid sign-ups need attention';
  }

  return 'Paid sign-ups ready';
};

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
  { label: 'Theme', value: tenant.theme },
  { label: 'Currency', value: tenant.currency },
  { label: 'Timezone', value: tenant.timezone },
  {
    label: 'Payments',
    value: globalAdminStripeAccountLabel(tenant),
  },
];
