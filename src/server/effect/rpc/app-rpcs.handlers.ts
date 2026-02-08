import type { Headers } from '@effect/platform';

import { Effect, Schema } from 'effect';

import { database } from '../../../db';
import { icons } from '../../../db/schema';
import {
  AppRpcs,
  ConfigPermissions,
  type IconRecord,
  type IconRpcError,
} from '../../../shared/rpc-contracts/app-rpcs';
import { Tenant } from '../../../types/custom/tenant';
import { serverEnvironment } from '../../config/environment';
import { computeIconSourceColor } from '../../utils/icon-color';
import { getPublicConfigEffect } from '../config/public-config.effect';

const decodeHeaderJson = <A, I>(
  value: string | undefined,
  schema: Schema.Schema<A, I, never>,
) => Schema.decodeUnknownSync(schema)(JSON.parse(value ?? 'null'));

const normalizeIconRecord = (
  icon: Pick<
    typeof icons.$inferSelect,
    'commonName' | 'friendlyName' | 'id' | 'sourceColor'
  >,
): IconRecord => ({
  commonName: icon.commonName,
  friendlyName: icon.friendlyName,
  id: icon.id,
  // eslint-disable-next-line unicorn/no-null
  sourceColor: icon.sourceColor ?? null,
});

const getFriendlyIconName = (icon: string): Effect.Effect<string, IconRpcError> =>
  Effect.sync(() => icon.split(':')).pipe(
    Effect.flatMap(([name, set]) => {
      if (!name) {
        return Effect.fail('INVALID_ICON_NAME' as const);
      }

      let friendlyName = name;
      if (set?.includes('-')) {
        for (const part of set.split('-')) {
          friendlyName = friendlyName.replaceAll(part, '');
        }
      }

      friendlyName = friendlyName.replaceAll('-', ' ').trim();

      return Effect.succeed(
        friendlyName
          .split(' ')
          .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
          .join(' '),
      );
    }),
  );

const ensureAuthenticated = (
  headers: Headers.Headers,
): Effect.Effect<void, IconRpcError> =>
  headers['x-evorto-authenticated'] === 'true'
    ? Effect.void
    : Effect.fail('UNAUTHORIZED' as const);

export const appRpcHandlers = AppRpcs.toLayer(
  Effect.succeed({
    'config.isAuthenticated': (_payload, options) =>
      Effect.succeed(options.headers['x-evorto-authenticated'] === 'true'),
    'config.permissions': (_payload, options) =>
      Effect.sync(() =>
        decodeHeaderJson(options.headers['x-evorto-permissions'], ConfigPermissions),
      ),
    'config.public': () => getPublicConfigEffect(serverEnvironment),
    'config.tenant': (_payload, options) =>
      Effect.sync(() =>
        decodeHeaderJson(options.headers['x-evorto-tenant'], Tenant),
      ),
    'icons.add': ({ icon }, options) =>
      Effect.gen(function* () {
        yield* ensureAuthenticated(options.headers);
        const tenant = decodeHeaderJson(options.headers['x-evorto-tenant'], Tenant);
        const friendlyName = yield* getFriendlyIconName(icon);
        const sourceColor = yield* Effect.promise(() => computeIconSourceColor(icon));
        const insertedIcons = yield* Effect.promise(() =>
          database
            .insert(icons)
            .values({
              commonName: icon,
              friendlyName,
              sourceColor,
              tenantId: tenant.id,
            })
            .returning(),
        );

        return insertedIcons.map((icon) => normalizeIconRecord(icon));
      }),
    'icons.search': ({ search }, options) =>
      Effect.gen(function* () {
        yield* ensureAuthenticated(options.headers);
        const tenant = decodeHeaderJson(options.headers['x-evorto-tenant'], Tenant);
        const matchingIcons = yield* Effect.promise(() =>
          database.query.icons.findMany({
            orderBy: { commonName: 'asc' },
            where: {
              commonName: { ilike: `%${search}%` },
              tenantId: tenant.id,
            },
          }),
        );

        return matchingIcons.map((icon) => normalizeIconRecord(icon));
      }),
  }),
);
