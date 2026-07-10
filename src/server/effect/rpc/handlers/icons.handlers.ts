import { RpcForbiddenError } from '@shared/errors/rpc-errors';
import {
  includesPermission,
  type Permission,
} from '@shared/permissions/permissions';
import {
  IconSourceBusyError,
  IconSourceUnavailableError,
  InvalidIconNameError,
} from '@shared/rpc-contracts/app-rpcs/icons.errors';
import {
  type IconAddUsage,
  isValidIcons8IconName,
} from '@shared/rpc-contracts/app-rpcs/icons.rpcs';
import { and, asc, eq, ilike, or } from 'drizzle-orm';
import { Effect } from 'effect';

import type { AppRpcHandlers } from './shared/handler-types';

import { Database, type DatabaseClient } from '../../../../db';
import { icons } from '../../../../db/schema';
import { computeIconSourceColor } from '../../../utils/icon-color';
import { canEditEvent } from './events/events.shared';
import { RpcAccess } from './shared/rpc-access.service';

const databaseEffect = <A>(
  operation: (database: DatabaseClient) => Effect.Effect<A, unknown, never>,
): Effect.Effect<A, never, Database> =>
  Database.use((database) => operation(database).pipe(Effect.orDie));

const forbidden = (permission?: Permission) =>
  new RpcForbiddenError({
    message: 'You are not allowed to add an icon for this use',
    permission,
  });

export const ensureIconCatalogReader = Effect.fn(
  'icons.ensureIconCatalogReader',
)(function* () {
  yield* RpcAccess.ensureAuthenticated();
  const context = yield* RpcAccess.current();
  if (includesPermission('globalAdmin:manageTenants', context.permissions)) {
    return;
  }
  yield* RpcAccess.requireUser();
});

const getFriendlyIconName = Effect.fn('icons.getFriendlyIconName')(function* (
  icon: string,
) {
  if (!isValidIcons8IconName(icon)) {
    return yield* new InvalidIconNameError({
      iconName: icon,
      message:
        'Use a lowercase Icons8 name with letters, numbers, hyphens, and at most one style suffix',
    });
  }

  const [name] = icon.split(':');
  if (!name) {
    return yield* new InvalidIconNameError({
      iconName: icon,
      message: 'Invalid icon name',
    });
  }

  return name
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
});

export const ensureIconUsageAuthorized = Effect.fn(
  'icons.ensureIconUsageAuthorized',
)(function* (usage: IconAddUsage) {
  yield* RpcAccess.ensureAuthenticated();
  const context = yield* RpcAccess.current();

  if (includesPermission('globalAdmin:manageTenants', context.permissions)) {
    const actorAuth0Id = context.authData['sub'];
    yield* Effect.logWarning('Global administrator added a tenant icon').pipe(
      Effect.annotateLogs({
        actorAuth0Id:
          typeof actorAuth0Id === 'string' ? actorAuth0Id : 'unknown',
        tenantId: context.tenant.id,
        usage: usage._tag,
      }),
    );
    return;
  }

  const user = yield* RpcAccess.requireUser();
  switch (usage._tag) {
    case 'categoryManagement': {
      yield* RpcAccess.ensurePermission('templates:manageCategories');
      return;
    }
    case 'eventCreate': {
      yield* RpcAccess.ensurePermission('events:create');
      return;
    }
    case 'eventEdit': {
      const event = yield* databaseEffect((database) =>
        database.query.eventInstances.findFirst({
          columns: { creatorId: true },
          where: {
            id: usage.eventId,
            tenantId: context.tenant.id,
          },
        }),
      );
      if (
        !event ||
        !canEditEvent({
          creatorId: event.creatorId,
          permissions: user.permissions,
          userId: user.id,
        })
      ) {
        return yield* forbidden();
      }
      return;
    }
    case 'templateCreate': {
      yield* RpcAccess.ensurePermission('templates:create');
      return;
    }
    case 'templateEdit': {
      yield* RpcAccess.ensurePermission('templates:editAll');
      const template = yield* databaseEffect((database) =>
        database.query.eventTemplates.findFirst({
          columns: { id: true },
          where: {
            id: usage.templateId,
            tenantId: context.tenant.id,
          },
        }),
      );
      if (!template) {
        return yield* forbidden('templates:editAll');
      }
      return;
    }
  }
});

const likeEscapeCharacter = String.fromCodePoint(92);

export const escapeIconSearch = (search: string): string =>
  [...search]
    .map((character) =>
      character === likeEscapeCharacter ||
      character === '%' ||
      character === '_'
        ? `${likeEscapeCharacter}${character}`
        : character,
    )
    .join('');

export const ICON_SEARCH_LIMIT = 50;

export const buildIconSearchPattern = (search: string): string =>
  `%${escapeIconSearch(search.trim())}%`;

const findIcon = (tenantId: string, commonName: string) =>
  databaseEffect((database) =>
    database.query.icons.findFirst({
      columns: {
        commonName: true,
        friendlyName: true,
        id: true,
        sourceColor: true,
      },
      where: { commonName, tenantId },
    }),
  );

export const iconHandlers = {
  'icons.add': ({ icon, usage }, _options) =>
    Effect.gen(function* () {
      yield* ensureIconUsageAuthorized(usage);
      const { tenant } = yield* RpcAccess.current();
      const friendlyName = yield* getFriendlyIconName(icon);

      const existingIcon = yield* findIcon(tenant.id, icon);
      if (existingIcon) return existingIcon;

      const iconSourceResult = yield* Effect.promise(() =>
        computeIconSourceColor(icon),
      );
      if (iconSourceResult._tag === 'busy') {
        return yield* new IconSourceBusyError({
          message: 'The icon source is busy. Try again shortly.',
        });
      }
      if (iconSourceResult._tag === 'unavailable') {
        yield* Effect.logWarning('Icons8 source validation failed').pipe(
          Effect.annotateLogs({
            icon,
            reason: iconSourceResult.reason,
            tenantId: tenant.id,
          }),
        );
        return yield* new IconSourceUnavailableError({
          iconName: icon,
          message:
            'That Icons8 icon could not be verified. Check the name and try again.',
        });
      }

      const insertedIcons = yield* databaseEffect((database) =>
        database
          .insert(icons)
          .values({
            commonName: icon,
            friendlyName,
            sourceColor: iconSourceResult.sourceColor,
            tenantId: tenant.id,
          })
          .onConflictDoNothing({
            target: [icons.commonName, icons.tenantId],
          })
          .returning({
            commonName: icons.commonName,
            friendlyName: icons.friendlyName,
            id: icons.id,
            sourceColor: icons.sourceColor,
          }),
      );

      const insertedIcon = insertedIcons[0];
      if (insertedIcon) return insertedIcon;

      const concurrentlyInsertedIcon = yield* findIcon(tenant.id, icon);
      if (!concurrentlyInsertedIcon) {
        return yield* Effect.die(
          new Error('Icon insert conflict did not resolve to an icon'),
        );
      }
      return concurrentlyInsertedIcon;
    }),
  'icons.search': ({ search }, _options) =>
    Effect.gen(function* () {
      yield* ensureIconCatalogReader();
      const { tenant } = yield* RpcAccess.current();
      const searchPattern = buildIconSearchPattern(search);
      const matchingIcons = yield* databaseEffect((database) =>
        database
          .select({
            commonName: icons.commonName,
            friendlyName: icons.friendlyName,
            id: icons.id,
            sourceColor: icons.sourceColor,
          })
          .from(icons)
          .where(
            and(
              eq(icons.tenantId, tenant.id),
              or(
                ilike(icons.commonName, searchPattern),
                ilike(icons.friendlyName, searchPattern),
              ),
            ),
          )
          .orderBy(asc(icons.commonName))
          .limit(ICON_SEARCH_LIMIT),
      );

      return matchingIcons;
    }),
} satisfies Partial<AppRpcHandlers>;
