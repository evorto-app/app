import type {
  GlobalAdminTenantRecord,
  GlobalAdminTenantWriteInput,
} from '@shared/rpc-contracts/app-rpcs/global-admin.rpcs';

export interface GlobalAdminTenantFormModel {
  currency: GlobalAdminTenantWriteInput['currency'];
  domain: string;
  locale: GlobalAdminTenantWriteInput['locale'];
  name: string;
  stripeAccountId: string;
  theme: GlobalAdminTenantWriteInput['theme'];
  timezone: GlobalAdminTenantWriteInput['timezone'];
}

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
  currency: tenant.currency as GlobalAdminTenantFormModel['currency'],
  domain: tenant.domain,
  locale: tenant.locale as GlobalAdminTenantFormModel['locale'],
  name: tenant.name,
  stripeAccountId: tenant.stripeAccountId ?? '',
  theme: tenant.theme as GlobalAdminTenantFormModel['theme'],
  timezone: tenant.timezone as GlobalAdminTenantFormModel['timezone'],
});

const optionalTrimmed = (value: string): string | undefined =>
  value.trim() || undefined;

export const globalAdminTenantPayloadFromForm = (
  model: GlobalAdminTenantFormModel,
): GlobalAdminTenantWriteInput => ({
  currency: model.currency,
  domain: model.domain.trim(),
  locale: model.locale,
  name: model.name.trim(),
  stripeAccountId: optionalTrimmed(model.stripeAccountId),
  theme: model.theme,
  timezone: model.timezone,
});
