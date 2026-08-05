import { describe, expect, it } from '@effect/vitest';
import { Effect, Schema } from 'effect';

import {
  PlatformRoleCreateInput,
  PlatformRoleMutationRpcError,
  PlatformTaxRatesImportInput,
  PlatformTenantUsersListInput,
} from './platform-tenant-admin.rpcs';

const roleCreateInput = {
  defaultOrganizerRole: false,
  defaultUserRole: true,
  description: '',
  displayInHub: true,
  name: 'Member',
  permissions: ['events:viewPublic'],
  reason: 'Restore a tenant role',
  targetTenantId: 'tenant-1',
};

describe('platform tenant-admin RPC schemas', () => {
  it.effect('accepts an empty role description for server normalization', () =>
    Effect.gen(function* () {
      const decoded = yield* Schema.decodeUnknownEffect(
        PlatformRoleCreateInput,
      )(roleCreateInput);

      expect(decoded.description).toBe('');
      expect(decoded.targetTenantId).toBe('tenant-1');
    }),
  );

  it.effect(
    'keeps known permissions structural for typed server-side validation',
    () =>
      Effect.gen(function* () {
        for (const permission of [
          'globalAdmin:*',
          'globalAdmin:manageTenants',
        ]) {
          const decoded = yield* Schema.decodeUnknownEffect(
            PlatformRoleCreateInput,
          )({ ...roleCreateInput, permissions: [permission] });

          expect(decoded.permissions).toEqual([permission]);
        }
      }),
  );

  it.effect('declares typed validation and duplicate-name errors', () =>
    Effect.gen(function* () {
      const validation = yield* Schema.decodeUnknownEffect(
        PlatformRoleMutationRpcError,
      )({
        _tag: 'RoleWriteValidationError',
        field: 'permissions',
        message:
          'Permissions reserved for Evorto administrators cannot be added to an organization role.',
      });
      expect(validation._tag).toBe('RoleWriteValidationError');

      const duplicate = yield* Schema.decodeUnknownEffect(
        PlatformRoleMutationRpcError,
      )({
        _tag: 'RoleNameAlreadyExistsError',
        message: 'A role named Member already exists',
        name: 'Member',
      });
      expect(duplicate._tag).toBe('RoleNameAlreadyExistsError');
    }),
  );

  it.effect('bounds the tenant-user page', () =>
    Effect.gen(function* () {
      const decoded = yield* Schema.decodeUnknownEffect(
        PlatformTenantUsersListInput,
      )({ limit: 100, offset: 0, targetTenantId: 'tenant-1' });
      expect(decoded.limit).toBe(100);

      const limitError = yield* Schema.decodeUnknownEffect(
        PlatformTenantUsersListInput,
      )({ limit: 101, offset: 0, targetTenantId: 'tenant-1' }).pipe(
        Effect.flip,
      );
      expect(limitError['_tag']).toBe('SchemaError');

      const zeroLimitError = yield* Schema.decodeUnknownEffect(
        PlatformTenantUsersListInput,
      )({ limit: 0, offset: 0, targetTenantId: 'tenant-1' }).pipe(Effect.flip);
      expect(zeroLimitError['_tag']).toBe('SchemaError');

      const offsetError = yield* Schema.decodeUnknownEffect(
        PlatformTenantUsersListInput,
      )({ limit: 100, offset: -1, targetTenantId: 'tenant-1' }).pipe(
        Effect.flip,
      );
      expect(offsetError['_tag']).toBe('SchemaError');

      const fractionalOffsetError = yield* Schema.decodeUnknownEffect(
        PlatformTenantUsersListInput,
      )({ limit: 100, offset: 0.5, targetTenantId: 'tenant-1' }).pipe(
        Effect.flip,
      );
      expect(fractionalOffsetError['_tag']).toBe('SchemaError');
    }),
  );

  it.effect('requires between one and one hundred tax-rate IDs', () =>
    Effect.gen(function* () {
      const baseInput = {
        reason: 'Import inclusive rates',
        targetTenantId: 'tenant-1',
      };
      const emptyError = yield* Schema.decodeUnknownEffect(
        PlatformTaxRatesImportInput,
      )({ ...baseInput, ids: [] }).pipe(Effect.flip);
      expect(emptyError['_tag']).toBe('SchemaError');

      const oversizedError = yield* Schema.decodeUnknownEffect(
        PlatformTaxRatesImportInput,
      )({
        ...baseInput,
        ids: Array.from({ length: 101 }, (_, index) => `txr_${index}`),
      }).pipe(Effect.flip);
      expect(oversizedError['_tag']).toBe('SchemaError');

      const decoded = yield* Schema.decodeUnknownEffect(
        PlatformTaxRatesImportInput,
      )({ ...baseInput, ids: ['txr_1'] });
      expect(decoded.ids).toEqual(['txr_1']);
    }),
  );
});
