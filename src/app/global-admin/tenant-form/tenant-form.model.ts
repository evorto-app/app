import type {
  GlobalAdminTenantMutationInput,
  GlobalAdminTenantRecord,
  GlobalAdminTenantWriteInput,
} from '@shared/rpc-contracts/app-rpcs/global-admin.rpcs';

import {
  normalizeTenantDomain,
  TenantDomainValidationError,
} from '@shared/tenant-origin';

import { getErrorMessage } from '../../core/error-message';

export interface GlobalAdminTenantFormModel {
  currency: GlobalAdminTenantWriteInput['currency'];
  domain: string;
  name: string;
  reason: string;
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

export const createGlobalAdminTenantFormModel =
  (): GlobalAdminTenantFormModel => ({
    currency: 'EUR',
    domain: '',
    name: '',
    reason: '',
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

export const normalizeGlobalAdminTenantDomain = (value: string): string =>
  normalizeTenantDomain(value);

export const globalAdminTenantDomainValidationMessage = (
  error: unknown,
): string => {
  if (error instanceof TenantDomainValidationError) {
    return error.message;
  }
  throw error;
};

export const globalAdminTenantUpdateErrorMessage = (error: unknown): string => {
  const errorTag =
    typeof error === 'object' && error !== null && '_tag' in error
      ? error._tag
      : undefined;
  if (errorTag !== 'GlobalAdminTenantUrlMigrationBlockedError') {
    return getErrorMessage(
      error,
      'The organization could not be updated. Try again.',
      ['RpcBadRequestError'],
    );
  }
  return 'The website address cannot be changed while payments, refunds, or ticket transfers are unfinished. Finish or cancel them and try again.';
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
