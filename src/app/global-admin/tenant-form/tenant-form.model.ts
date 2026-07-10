import type {
  GlobalAdminTenantRecord,
  GlobalAdminTenantWriteInput,
} from '@shared/rpc-contracts/app-rpcs/global-admin.rpcs';

import { normalizeTenantDomain } from '@shared/tenant-origin';

export interface GlobalAdminTenantFormModel {
  currency: GlobalAdminTenantWriteInput['currency'];
  domain: string;
  locale: GlobalAdminTenantWriteInput['locale'];
  name: string;
  stripeAccountId: string;
  theme: GlobalAdminTenantWriteInput['theme'];
  timezone: GlobalAdminTenantWriteInput['timezone'];
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
    locale: 'en-GB',
    name: '',
    stripeAccountId: '',
    theme: 'evorto',
    timezone: 'Europe/Berlin',
  });

export const globalAdminTenantFormModelFromRecord = (
  tenant: GlobalAdminTenantRecord,
): GlobalAdminTenantFormModel => ({
  currency: tenant.currency,
  domain: tenant.domain,
  locale: tenant.locale,
  name: tenant.name,
  stripeAccountId: tenant.stripeAccountId ?? '',
  theme: tenant.theme,
  timezone: tenant.timezone,
});

const optionalTrimmed = (value: string): string | undefined =>
  value.trim() || undefined;

export const normalizeGlobalAdminTenantDomain = (value: string): string =>
  normalizeTenantDomain(value);

export const globalAdminTenantPayloadFromForm = (
  model: GlobalAdminTenantFormModel,
): GlobalAdminTenantWriteInput => {
  const domain = normalizeTenantDomain(model.domain);

  return {
    currency: model.currency,
    domain,
    locale: model.locale,
    name: model.name.trim(),
    stripeAccountId: optionalTrimmed(model.stripeAccountId),
    theme: model.theme,
    timezone: model.timezone,
  };
};

export const globalAdminTenantSubmitDisabled = ({
  formInvalid,
  formSubmitting,
  mutationPending,
}: {
  formInvalid: boolean;
  formSubmitting: boolean;
  mutationPending: boolean;
}): boolean => formInvalid || formSubmitting || mutationPending;
