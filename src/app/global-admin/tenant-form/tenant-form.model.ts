import type {
  GlobalAdminTenantMutationInput,
  GlobalAdminTenantRecord,
  GlobalAdminTenantWriteInput,
} from '@shared/rpc-contracts/app-rpcs/global-admin.rpcs';

import { normalizeTenantDomain } from '@shared/tenant-origin';

import { getErrorMessage } from '../../core/error-message';

export interface GlobalAdminTenantFormModel {
  currency: GlobalAdminTenantWriteInput['currency'];
  domain: string;
  name: string;
  reason: string;
  stripeAccountId: string;
  theme: GlobalAdminTenantWriteInput['theme'];
  timezone: GlobalAdminTenantWriteInput['timezone'];
}

interface GlobalAdminTenantEditFormSource {
  tenant: GlobalAdminTenantRecord | null | undefined;
  tenantId: string;
}

interface PreviousGlobalAdminTenantEditFormModel {
  source: GlobalAdminTenantEditFormSource;
  value: GlobalAdminTenantFormModel;
}

export const globalAdminTenantRelaunchScopeItems = [
  'One active primary domain is managed here; its secure HTTPS origin is derived from the normalized host.',
  'Custom-domain verification and multi-domain automation are deferred.',
  'Tenant-admin impersonation is not available in the current relaunch surface.',
] as const;

export const createGlobalAdminTenantFormModel =
  (): GlobalAdminTenantFormModel => ({
    currency: 'EUR',
    domain: '',
    name: '',
    reason: '',
    stripeAccountId: '',
    theme: 'evorto',
    timezone: 'Europe/Berlin',
  });

export const globalAdminTenantFormModelFromRecord = (
  tenant: GlobalAdminTenantRecord,
): GlobalAdminTenantFormModel => ({
  currency: tenant.currency,
  domain: tenant.domain,
  name: tenant.name,
  reason: '',
  stripeAccountId: tenant.stripeAccountId ?? '',
  theme: tenant.theme,
  timezone: tenant.timezone,
});

export const resolveGlobalAdminTenantEditFormModel = (
  { tenant, tenantId }: GlobalAdminTenantEditFormSource,
  previous?: PreviousGlobalAdminTenantEditFormModel,
): GlobalAdminTenantFormModel => {
  if (tenant?.id === tenantId) {
    if (
      previous?.source.tenant?.id === tenant.id &&
      previous.source.tenantId === tenantId
    ) {
      return previous.value;
    }

    return globalAdminTenantFormModelFromRecord(tenant);
  }

  return previous?.source.tenantId === tenantId
    ? previous.value
    : createGlobalAdminTenantFormModel();
};

const optionalTrimmed = (value: string): string | undefined =>
  value.trim() || undefined;

export const normalizeGlobalAdminTenantDomain = (value: string): string =>
  normalizeTenantDomain(value);

export const globalAdminTenantUpdateErrorMessage = (error: unknown): string => {
  const message = getErrorMessage(error, 'Failed to update tenant');
  if (
    !error ||
    typeof error !== 'object' ||
    Reflect.get(error, '_tag') !== 'GlobalAdminTenantUrlMigrationBlockedError'
  ) {
    return message;
  }

  const reason = Reflect.get(error, 'reason');
  return typeof reason === 'string' && reason.trim().length > 0
    ? `${message}. ${reason}`
    : message;
};

export const globalAdminTenantPayloadFromForm = (
  model: GlobalAdminTenantFormModel,
): GlobalAdminTenantMutationInput => ({
  reason: model.reason.trim(),
  tenant: (() => {
    const domain = normalizeTenantDomain(model.domain);
    return {
      currency: model.currency,
      domain,
      name: model.name.trim(),
      stripeAccountId: optionalTrimmed(model.stripeAccountId),
      theme: model.theme,
      timezone: model.timezone,
    };
  })(),
});

export const globalAdminTenantSubmitDisabled = ({
  formInvalid,
  formSubmitting,
  mutationPending,
}: {
  formInvalid: boolean;
  formSubmitting: boolean;
  mutationPending: boolean;
}): boolean => formInvalid || formSubmitting || mutationPending;
