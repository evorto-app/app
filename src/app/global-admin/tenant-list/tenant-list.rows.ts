import type { GlobalAdminTenantRecord } from '@shared/rpc-contracts/app-rpcs/global-admin.rpcs';

import { tenantTimezoneLabel } from '../../core/geography-labels';

const searchableTenantFields = (tenant: GlobalAdminTenantRecord): string[] => [
  tenant.currency,
  tenant.domain,
  tenant.name,
  tenant.theme,
  tenantTimezoneLabel(tenant.timezone),
  tenant.paymentsConfigured
    ? 'paid sign-ups ready'
    : 'paid sign-ups need attention',
];

export const globalAdminPaymentStatusLabel = (
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
  { label: 'Website address', value: tenant.domain },
  {
    label: 'Theme',
    value:
      tenant.theme === 'esn'
        ? 'ESN theme'
        : tenant.theme === 'classic'
          ? 'Classic Evorto theme'
          : 'Default theme',
  },
  { label: 'Currency', value: tenant.currency },
  { label: 'Time zone', value: tenantTimezoneLabel(tenant.timezone) },
  {
    label: 'Payments',
    value: globalAdminPaymentStatusLabel(tenant),
  },
];
