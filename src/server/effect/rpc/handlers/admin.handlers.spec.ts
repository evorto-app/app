import { describe, expect, it } from '@effect/vitest';
import { Effect, Layer } from 'effect';

import { Database } from '../../../../db';
import {
  encodeRpcContextHeaderJson,
  RPC_CONTEXT_HEADERS,
} from '../rpc-context-headers';
import { adminHandlers } from './admin.handlers';

const createTenant = (id = 'tenant-1') => ({
  currency: 'EUR' as const,
  defaultLocation: null,
  discountProviders: {
    esnCard: {
      config: {},
      status: 'disabled' as const,
    },
  },
  domain: `${id}.example.com`,
  id,
  locale: 'en',
  name: id,
  receiptSettings: {
    allowOther: false,
    receiptCountries: ['NL'],
  },
  stripeAccountId: null,
  theme: 'evorto' as const,
  timezone: 'Europe/Amsterdam',
});

const createAdminHeaders = () => ({
  [RPC_CONTEXT_HEADERS.AUTHENTICATED]: 'true',
  [RPC_CONTEXT_HEADERS.PERMISSIONS]: encodeRpcContextHeaderJson([
    'admin:manageRoles',
  ]),
  [RPC_CONTEXT_HEADERS.TENANT]: encodeRpcContextHeaderJson(createTenant()),
});

const createSettingsAdminHeaders = () => ({
  [RPC_CONTEXT_HEADERS.AUTHENTICATED]: 'true',
  [RPC_CONTEXT_HEADERS.PERMISSIONS]: encodeRpcContextHeaderJson([
    'admin:changeSettings',
  ]),
  [RPC_CONTEXT_HEADERS.TENANT]: encodeRpcContextHeaderJson(createTenant()),
});

describe('adminHandlers role permissions', () => {
  it.effect('findMany requires role management permission', () =>
    Effect.gen(function* () {
      const error = yield* adminHandlers['admin.roles.findMany']({}, {
        headers: {
          [RPC_CONTEXT_HEADERS.AUTHENTICATED]: 'true',
          [RPC_CONTEXT_HEADERS.PERMISSIONS]: encodeRpcContextHeaderJson([]),
        },
      } as never).pipe(Effect.flip);

      expect(error['_tag']).toBe('RpcForbiddenError');
      expect(error.permission).toBe('admin:manageRoles');
    }),
  );

  it.effect('findOne returns the canonical hub visibility field only', () =>
    Effect.gen(function* () {
      const database = {
        query: {
          roles: {
            findFirst: () =>
              Effect.succeed({
                collapseMembersInHub: true,
                defaultOrganizerRole: false,
                defaultUserRole: true,
                description: 'Visible in the hub',
                displayInHub: true,
                id: 'role-1',
                name: 'Member',
                permissions: ['events:viewPublic'],
                sortOrder: 1,
              }),
          },
        },
      };

      const role = yield* adminHandlers['admin.roles.findOne'](
        { id: 'role-1' },
        { headers: createAdminHeaders() } as never,
      ).pipe(Effect.provide(Layer.succeed(Database, database as never)));

      expect(role).toMatchObject({
        displayInHub: true,
        id: 'role-1',
        name: 'Member',
      });
      expect(role).not.toHaveProperty('showInHub');
    }),
  );
});

describe('adminHandlers tenant settings', () => {
  it.effect(
    'updates tenant SEO settings through the validated tenant shape',
    () =>
      Effect.gen(function* () {
        let capturedUpdate: Record<string, unknown> | undefined;
        const updateQuery = {
          returning: () =>
            Effect.succeed([
              {
                id: 'tenant-1',
              },
            ]),
          set: (value: Record<string, unknown>) => {
            capturedUpdate = value;
            return updateQuery;
          },
          where: () => updateQuery,
        };
        const database = {
          update: () => updateQuery,
        };

        const result = yield* adminHandlers['admin.tenant.updateSettings'](
          {
            allowOther: true,
            defaultLocation: null,
            esnCardEnabled: false,
            receiptCountries: ['NL'],
            seoDescription: '  Public description  ',
            seoTitle: '  Public title  ',
            theme: 'evorto',
          },
          { headers: createSettingsAdminHeaders() } as never,
        ).pipe(Effect.provide(Layer.succeed(Database, database as never)));

        expect(capturedUpdate).toMatchObject({
          seoDescription: 'Public description',
          seoTitle: 'Public title',
        });
        expect(result).toMatchObject({
          seoDescription: 'Public description',
          seoTitle: 'Public title',
        });
      }),
  );
});
