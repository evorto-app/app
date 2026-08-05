import type { CanDeactivateFn } from '@angular/router';

import {
  afterNextRender,
  ApplicationRef,
  inject,
  signal,
  type Signal,
} from '@angular/core';

import type { ClientTenantConfig } from '../../../shared/rpc-contracts/app-rpcs/config.rpcs';
import type { ConfigService } from '../../core/config.service';

export interface TenantSettingsWithDirtyState {
  hasUnsavedSettingsChanges(): boolean;
}

const unsavedTenantSettingsMessage =
  'You have unsaved settings changes. Leave this page and discard them?';

export const initializedTenant = (
  configService: Pick<ConfigService, 'tenantSignal'>,
): ClientTenantConfig => {
  const tenant = configService.tenantSignal();
  if (tenant === null) {
    throw new Error('Tenant settings require initialized tenant configuration');
  }
  return tenant;
};

export const tenantSettingsShouldHydrate = (formDirty: boolean): boolean =>
  !formDirty;

export const tenantSettingsInteractionReady = (): Signal<boolean> => {
  const applicationRef = inject(ApplicationRef);
  const interactionReady = signal(false);
  afterNextRender(() => {
    void applicationRef.whenStable().then(() => interactionReady.set(true));
  });
  return interactionReady.asReadonly();
};

export const tenantSettingsCanDeactivate = (
  component: TenantSettingsWithDirtyState,
  confirmDiscard:
    ((message: string) => boolean) | undefined = globalThis.confirm,
): boolean => {
  if (!component.hasUnsavedSettingsChanges()) return true;
  return confirmDiscard?.(unsavedTenantSettingsMessage) ?? false;
};

export const tenantSettingsUnsavedChangesGuard: CanDeactivateFn<
  TenantSettingsWithDirtyState
> = (component) => tenantSettingsCanDeactivate(component);

export const tenantSettingsSaveDisabled = ({
  formInvalid,
  formSubmitting,
  interactionReady,
  mutationPending,
}: {
  formInvalid: boolean;
  formSubmitting: boolean;
  interactionReady: boolean;
  mutationPending: boolean;
}): boolean =>
  !interactionReady || formInvalid || formSubmitting || mutationPending;

export const optionalTrimmed = (value: string): string | undefined =>
  value.trim() || undefined;
