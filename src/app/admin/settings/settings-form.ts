import type { CanDeactivateFn } from '@angular/router';
import type {
  QueryClient,
  QueryFilters,
} from '@tanstack/angular-query-experimental';

import {
  afterNextRender,
  ApplicationRef,
  inject,
  signal,
  type Signal,
} from '@angular/core';
import { TenantSettingsConflictError } from '@shared/tenant-settings-snapshot';
import { Schema } from 'effect';

import type { ClientTenantConfig } from '../../../shared/rpc-contracts/app-rpcs/config.rpcs';
import type { ConfigService } from '../../core/config.service';

import {
  RpcForbiddenError,
  RpcUnauthorizedError,
} from '../../../shared/errors/rpc-errors';
import { getErrorMessage } from '../../core/error-message';

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

export type TenantSettingsSaveOutcome =
  'saved-read-failed' | 'saved-read-paused' | 'stale' | 'unknown';

export const isTenantSettingsConflict = Schema.is(TenantSettingsConflictError);

export const tenantSettingsSaveDenial = (error: unknown): string => {
  if (error instanceof RpcUnauthorizedError) {
    return 'Sign in again before changing these settings.';
  }
  if (error instanceof RpcForbiddenError) {
    return 'Your account does not have access to change these settings. Ask an administrator to check your access.';
  }
  return getErrorMessage(error, '', [
    'RpcBadRequestError',
    'AdminTenantNotFoundError',
  ]);
};

export const readTenantSettings = async (
  queryClient: QueryClient,
  filters: readonly [QueryFilters, ...QueryFilters[]],
): Promise<'fresh' | 'paused'> => {
  const activeReadsByFilter = filters.map((filter) =>
    queryClient
      .getQueryCache()
      .findAll({ ...filter, type: 'active' })
      .filter((query) => !query.isDisabled() && !query.isStatic()),
  );
  const activeQueries = [...new Set(activeReadsByFilter.flat())];
  const invalidations = filters.map((filter) =>
    queryClient.invalidateQueries(filter, { throwOnError: true }),
  );
  // Initially paused reads resolve invalidation without reading current data.
  const wasPaused = activeQueries.some(
    (query) => query.state.fetchStatus === 'paused',
  );
  const siblings = activeQueries
    .filter((query) => query.state.fetchStatus === 'fetching')
    .map((query) => query.promise);
  const results = await Promise.allSettled([...invalidations, ...siblings]);
  const failures: unknown[] = [];
  for (const result of results) {
    if (result.status === 'rejected') failures.push(result.reason);
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, 'Settings follow-up reads failed');
  }
  if (
    wasPaused ||
    activeQueries.some((query) => query.state.fetchStatus === 'paused')
  ) {
    return 'paused';
  }
  if (
    activeReadsByFilter[0]?.length === 0 ||
    activeQueries.some(
      (query) =>
        query.state.status !== 'success' ||
        query.state.fetchStatus !== 'idle' ||
        query.state.isInvalidated,
    )
  ) {
    throw new Error('A successful current settings read is required');
  }
  return 'fresh';
};
