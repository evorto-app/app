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
  faviconUrl: null,
  id,
  locale: 'en',
  logoUrl: null,
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

const createSettingsInput = () => ({
  allowOther: true,
  currency: 'EUR' as const,
  defaultLocation: null,
  esnCardEnabled: false,
  locale: 'en-GB' as const,
  receiptCountries: ['NL'],
  theme: 'evorto' as const,
  timezone: 'Europe/Berlin' as const,
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
          query: {
            eventInstances: {
              findFirst: () => Effect.succeed(null),
            },
            transactions: {
              findFirst: () => Effect.succeed(null),
            },
          },
          update: () => updateQuery,
        };

        const result = yield* adminHandlers['admin.tenant.updateSettings'](
          {
            allowOther: true,
            currency: 'AUD',
            defaultLocation: null,
            esnCardEnabled: false,
            faviconUrl: ' https://cdn.example.org/favicon.ico ',
            legalNoticeText: '  Tenant imprint text  ',
            legalNoticeUrl: ' https://section.example.org/imprint ',
            locale: 'en-AU',
            logoUrl: 'https://cdn.example.org/logo.svg',
            privacyPolicyText: ' Tenant privacy text ',
            privacyPolicyUrl: 'https://section.example.org/privacy',
            receiptCountries: ['NL'],
            seoDescription: '  Public description  ',
            seoTitle: '  Public title  ',
            termsText: ' Tenant terms text ',
            termsUrl: 'https://section.example.org/terms',
            theme: 'evorto',
            timezone: 'Australia/Brisbane',
          },
          { headers: createSettingsAdminHeaders() } as never,
        ).pipe(Effect.provide(Layer.succeed(Database, database as never)));

        expect(capturedUpdate).toMatchObject({
          currency: 'AUD',
          faviconUrl: 'https://cdn.example.org/favicon.ico',
          legalNoticeText: 'Tenant imprint text',
          legalNoticeUrl: 'https://section.example.org/imprint',
          locale: 'en-AU',
          logoUrl: 'https://cdn.example.org/logo.svg',
          privacyPolicyText: 'Tenant privacy text',
          privacyPolicyUrl: 'https://section.example.org/privacy',
          seoDescription: 'Public description',
          seoTitle: 'Public title',
          termsText: 'Tenant terms text',
          termsUrl: 'https://section.example.org/terms',
          timezone: 'Australia/Brisbane',
        });
        expect(result).toMatchObject({
          currency: 'AUD',
          faviconUrl: 'https://cdn.example.org/favicon.ico',
          legalNoticeText: 'Tenant imprint text',
          legalNoticeUrl: 'https://section.example.org/imprint',
          locale: 'en-AU',
          logoUrl: 'https://cdn.example.org/logo.svg',
          privacyPolicyText: 'Tenant privacy text',
          privacyPolicyUrl: 'https://section.example.org/privacy',
          seoDescription: 'Public description',
          seoTitle: 'Public title',
          termsText: 'Tenant terms text',
          termsUrl: 'https://section.example.org/terms',
          timezone: 'Australia/Brisbane',
        });
      }),
  );

  it.effect('rejects invalid tenant legal-link URLs', () =>
    Effect.gen(function* () {
      const database = {
        update: () => {
          throw new Error('database should not be touched');
        },
      };

      const error = yield* adminHandlers['admin.tenant.updateSettings'](
        {
          allowOther: true,
          currency: 'EUR',
          defaultLocation: null,
          esnCardEnabled: false,
          legalNoticeUrl: 'not a url',
          locale: 'en-GB',
          receiptCountries: ['NL'],
          theme: 'evorto',
          timezone: 'Europe/Berlin',
        },
        { headers: createSettingsAdminHeaders() } as never,
      ).pipe(
        Effect.provide(Layer.succeed(Database, database as never)),
        Effect.flip,
      );

      expect(error['_tag']).toBe('RpcBadRequestError');
      expect(error.message).toBe('Invalid tenant legal links');
    }),
  );

  it.effect('preserves uploaded tenant brand asset route URLs', () =>
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
          currency: 'EUR',
          defaultLocation: null,
          esnCardEnabled: false,
          faviconUrl: ' /tenant-assets/tenant-1/favicon/favicon.ico ',
          locale: 'en-GB',
          logoUrl: '/tenant-assets/tenant-1/logo/logo.png',
          receiptCountries: ['NL'],
          theme: 'evorto',
          timezone: 'Europe/Berlin',
        },
        { headers: createSettingsAdminHeaders() } as never,
      ).pipe(Effect.provide(Layer.succeed(Database, database as never)));

      expect(capturedUpdate).toMatchObject({
        faviconUrl: '/tenant-assets/tenant-1/favicon/favicon.ico',
        logoUrl: '/tenant-assets/tenant-1/logo/logo.png',
      });
      expect(result).toMatchObject({
        faviconUrl: '/tenant-assets/tenant-1/favicon/favicon.ico',
        logoUrl: '/tenant-assets/tenant-1/logo/logo.png',
      });
    }),
  );

  it.effect('rejects invalid tenant brand asset URLs', () =>
    Effect.gen(function* () {
      const database = {
        update: () => {
          throw new Error('database should not be touched');
        },
      };

      const error = yield* adminHandlers['admin.tenant.updateSettings'](
        {
          allowOther: true,
          currency: 'EUR',
          defaultLocation: null,
          esnCardEnabled: false,
          locale: 'en-GB',
          logoUrl: 'file:///tmp/logo.svg',
          receiptCountries: ['NL'],
          theme: 'evorto',
          timezone: 'Europe/Berlin',
        },
        { headers: createSettingsAdminHeaders() } as never,
      ).pipe(
        Effect.provide(Layer.succeed(Database, database as never)),
        Effect.flip,
      );

      expect(error['_tag']).toBe('RpcBadRequestError');
      expect(error.message).toBe('Invalid tenant brand assets');
    }),
  );

  it.effect(
    'rejects uploaded tenant brand asset paths with encoded separators',
    () =>
      Effect.gen(function* () {
        const database = {
          update: () => {
            throw new Error('database should not be touched');
          },
        };

        const error = yield* adminHandlers['admin.tenant.updateSettings'](
          {
            allowOther: true,
            currency: 'EUR',
            defaultLocation: null,
            esnCardEnabled: false,
            locale: 'en-GB',
            logoUrl: '/tenant-assets/tenant-1/logo/..%2Fsecret.png',
            receiptCountries: ['NL'],
            theme: 'evorto',
            timezone: 'Europe/Berlin',
          },
          { headers: createSettingsAdminHeaders() } as never,
        ).pipe(
          Effect.provide(Layer.succeed(Database, database as never)),
          Effect.flip,
        );

        expect(error['_tag']).toBe('RpcBadRequestError');
        expect(error.message).toBe('Invalid tenant brand assets');
      }),
  );

  it.effect(
    'rejects locale and money setting changes when tenant events exist',
    () =>
      Effect.gen(function* () {
        const database = {
          query: {
            eventInstances: {
              findFirst: () => Effect.succeed({ id: 'event-1' }),
            },
            transactions: {
              findFirst: () => {
                throw new Error('transaction query should not be touched');
              },
            },
          },
          update: () => {
            throw new Error('database update should not be touched');
          },
        };

        const error = yield* adminHandlers['admin.tenant.updateSettings'](
          {
            ...createSettingsInput(),
            currency: 'CZK',
          },
          { headers: createSettingsAdminHeaders() } as never,
        ).pipe(
          Effect.provide(Layer.succeed(Database, database as never)),
          Effect.flip,
        );

        expect(error['_tag']).toBe('RpcBadRequestError');
        expect(error.message).toBe(
          'Tenant locale and money settings are locked',
        );
      }),
  );

  it.effect(
    'rejects locale and money setting changes when tenant transactions exist',
    () =>
      Effect.gen(function* () {
        const database = {
          query: {
            eventInstances: {
              findFirst: () => Effect.succeed(null),
            },
            transactions: {
              findFirst: () => Effect.succeed({ id: 'transaction-1' }),
            },
          },
          update: () => {
            throw new Error('database update should not be touched');
          },
        };

        const error = yield* adminHandlers['admin.tenant.updateSettings'](
          {
            ...createSettingsInput(),
            timezone: 'Europe/Prague',
          },
          { headers: createSettingsAdminHeaders() } as never,
        ).pipe(
          Effect.provide(Layer.succeed(Database, database as never)),
          Effect.flip,
        );

        expect(error['_tag']).toBe('RpcBadRequestError');
        expect(error.message).toBe(
          'Tenant locale and money settings are locked',
        );
      }),
  );
});
