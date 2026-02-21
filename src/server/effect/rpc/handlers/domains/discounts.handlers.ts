/* eslint-disable @typescript-eslint/no-unused-vars */

import type { Headers } from '@effect/platform';

import {
  buildSelectableReceiptCountries,
  normalizeReceiptCountryCode,
  OTHER_RECEIPT_COUNTRY_CODE,
  resolveReceiptCountrySettings,
} from '@shared/finance/receipt-countries';
import {
  resolveTenantDiscountProviders,
  resolveTenantReceiptSettings,
  type TenantDiscountProviders,
} from '@shared/tenant-config';
import {
  and,
  arrayOverlaps,
  count,
  desc,
  eq,
  exists,
  gt,
  inArray,
  not,
} from 'drizzle-orm';
import { Effect, Schema } from 'effect';
import { groupBy } from 'es-toolkit';
import { DateTime } from 'luxon';

import { Database, type DatabaseClient } from '../../../../../db';
import { createId } from '../../../../../db/create-id';
import {
  eventInstances,
  eventRegistrationOptionDiscounts,
  eventRegistrationOptions,
  eventRegistrations,
  eventTemplateCategories,
  eventTemplates,
  financeReceipts,
  icons,
  roles,
  rolesToTenantUsers,
  templateRegistrationOptionDiscounts,
  templateRegistrationOptions,
  tenants,
  tenantStripeTaxRates,
  transactions,
  userDiscountCards,
  users,
  usersToTenants,
} from '../../../../../db/schema';
import { type Permission } from '../../../../../shared/permissions/permissions';
import {
  type AdminHubRoleRecord,
  type AdminRoleRecord,
  AppRpcs,
  ConfigPermissions,
  type IconRecord,
  type IconRpcError,
  type TemplateCategoryRecord,
  type TemplateListRecord,
  type TemplatesByCategoryRecord,
  UsersAuthData,
} from '../../../../../shared/rpc-contracts/app-rpcs';
import { Tenant } from '../../../../../types/custom/tenant';
import { User } from '../../../../../types/custom/user';
import { serverEnvironment } from '../../../../config/environment';
import { normalizeEsnCardConfig } from '../../../../discounts/discount-provider-config';
import {
  Adapters,
  PROVIDERS,
  type ProviderType,
} from '../../../../discounts/providers';
import { createCloudflareImageDirectUpload } from '../../../../integrations/cloudflare-images';
import {
  getSignedReceiptObjectUrlFromR2,
  uploadReceiptOriginalToR2,
} from '../../../../integrations/cloudflare-r2';
import { stripe } from '../../../../stripe-client';
import { computeIconSourceColor } from '../../../../utils/icon-color';
import {
  isMeaningfulRichTextHtml,
  sanitizeOptionalRichTextHtml,
  sanitizeRichTextHtml,
} from '../../../../utils/rich-text-sanitize';
import { validateTaxRate } from '../../../../utils/validate-tax-rate';
import { getPublicConfigEffect } from '../../../config/public-config.effect';
import {
  decodeRpcContextHeaderJson,
  RPC_CONTEXT_HEADERS,
} from '../../rpc-context-headers';

import type { AppRpcHandlers } from '../shared/handler-types';

const ALLOWED_IMAGE_MIME_TYPES = [
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;
const ALLOWED_IMAGE_MIME_TYPE_SET = new Set<string>(ALLOWED_IMAGE_MIME_TYPES);
const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_RECEIPT_ORIGINAL_SIZE_BYTES = 20 * 1024 * 1024;
const RECEIPT_PREVIEW_SIGNED_URL_TTL_SECONDS = 60 * 15;
const LOCAL_RECEIPT_STORAGE_KEY_PREFIX = 'local-unavailable/';

const dbEffect = <A>(
  operation: (database: DatabaseClient) => Effect.Effect<A, unknown, never>,
): Effect.Effect<A, never, Database> =>
  Effect.flatMap(Database, (database) => operation(database).pipe(Effect.orDie));

interface ReceiptCountryConfigTenant {
  receiptSettings?:
    | null
    | undefined
    | {
        allowOther?: boolean | undefined;
        receiptCountries?: readonly string[] | undefined;
      };
}

interface ReceiptWithStoragePreview {
  attachmentStorageKey: null | string;
  id: string;
  previewImageUrl: null | string;
}

const withSignedReceiptPreviewUrl = async <T extends ReceiptWithStoragePreview>(
  receipt: T,
): Promise<T> => {
  if (
    !receipt.attachmentStorageKey ||
    receipt.attachmentStorageKey.startsWith(LOCAL_RECEIPT_STORAGE_KEY_PREFIX)
  ) {
    return {
      ...receipt,
      previewImageUrl: null,
    };
  }

  try {
    const signedPreviewUrl = await getSignedReceiptObjectUrlFromR2({
      expiresInSeconds: RECEIPT_PREVIEW_SIGNED_URL_TTL_SECONDS,
      key: receipt.attachmentStorageKey,
    });
    return {
      ...receipt,
      previewImageUrl: signedPreviewUrl,
    };
  } catch {
    return {
      ...receipt,
      previewImageUrl: null,
    };
  }
};

const isAllowedReceiptMimeType = (mimeType: string): boolean =>
  mimeType.startsWith('image/') || mimeType === 'application/pdf';

const sanitizeFileName = (fileName: string): string =>
  fileName
    .trim()
    .replaceAll(/[^A-Za-z0-9._-]+/g, '-')
    .slice(0, 120) || 'receipt';

const isCloudflareR2Configured = () =>
  Boolean(
    serverEnvironment.CLOUDFLARE_R2_BUCKET &&
    serverEnvironment.CLOUDFLARE_R2_S3_ENDPOINT &&
    serverEnvironment.CLOUDFLARE_R2_S3_KEY &&
    serverEnvironment.CLOUDFLARE_R2_S3_KEY_ID,
  );

const resolveTenantSelectableReceiptCountries = (
  tenant: ReceiptCountryConfigTenant,
): string[] =>
  buildSelectableReceiptCountries(
    resolveReceiptCountrySettings(tenant.receiptSettings ?? undefined),
  );

const validateReceiptCountryForTenant = (
  tenant: ReceiptCountryConfigTenant,
  purchaseCountry: string,
): null | string => {
  if (purchaseCountry === OTHER_RECEIPT_COUNTRY_CODE) {
    const receiptCountrySettings = resolveReceiptCountrySettings(
      tenant.receiptSettings ?? undefined,
    );
    return receiptCountrySettings.allowOther
      ? OTHER_RECEIPT_COUNTRY_CODE
      : null;
  }

  const normalizedCountry = normalizeReceiptCountryCode(purchaseCountry);
  if (!normalizedCountry) {
    return null;
  }

  const allowedCountries = resolveTenantSelectableReceiptCountries(tenant);
  return allowedCountries.includes(normalizedCountry)
    ? normalizedCountry
    : null;
};

const decodeHeaderJson = <A, I>(
  value: string | undefined,
  schema: Schema.Schema<A, I, never>,
) => Schema.decodeUnknownSync(schema)(decodeRpcContextHeaderJson(value));

const normalizeIconRecord = (
  icon: Pick<
    typeof icons.$inferSelect,
    'commonName' | 'friendlyName' | 'id' | 'sourceColor'
  >,
): IconRecord => ({
  commonName: icon.commonName,
  friendlyName: icon.friendlyName,
  id: icon.id,
  sourceColor: icon.sourceColor ?? null,
});

const normalizeTemplateCategoryRecord = (
  templateCategory: Pick<
    typeof eventTemplateCategories.$inferSelect,
    'icon' | 'id' | 'title'
  >,
): TemplateCategoryRecord => ({
  icon: templateCategory.icon,
  id: templateCategory.id,
  title: templateCategory.title,
});

const normalizeTemplateRecord = (
  template: Pick<typeof eventTemplates.$inferSelect, 'icon' | 'id' | 'title'>,
): TemplateListRecord => ({
  icon: template.icon,
  id: template.id,
  title: template.title,
});

const normalizeTemplateFindOneRecord = (
  template: {
    categoryId: string;
    description: string;
    icon: typeof eventTemplates.$inferSelect.icon;
    id: string;
    location: typeof eventTemplates.$inferSelect.location;
    registrationOptions: readonly {
      closeRegistrationOffset: number;
      description: null | string;
      id: string;
      isPaid: boolean;
      openRegistrationOffset: number;
      organizingRegistration: boolean;
      price: number;
      registeredDescription: null | string;
      registrationMode: 'application' | 'fcfs' | 'random';
      roleIds: string[];
      spots: number;
      stripeTaxRateId: null | string;
      title: string;
    }[];
    title: string;
  },
  rolesById: ReadonlyMap<string, { id: string; name: string }>,
): {
  categoryId: string;
  description: string;
  icon: typeof eventTemplates.$inferSelect.icon;
  id: string;
  location: null | typeof eventTemplates.$inferSelect.location;
  registrationOptions: {
    closeRegistrationOffset: number;
    description: null | string;
    id: string;
    isPaid: boolean;
    openRegistrationOffset: number;
    organizingRegistration: boolean;
    price: number;
    registeredDescription: null | string;
    registrationMode: 'application' | 'fcfs' | 'random';
    roleIds: string[];
    roles: { id: string; name: string }[];
    spots: number;
    stripeTaxRateId: null | string;
    title: string;
  }[];
  title: string;
} => ({
  categoryId: template.categoryId,
  description: template.description,
  icon: template.icon,
  id: template.id,
  location: template.location ?? null,
  registrationOptions: template.registrationOptions.map((option) => ({
    closeRegistrationOffset: option.closeRegistrationOffset,
    description: option.description ?? null,
    id: option.id,
    isPaid: option.isPaid,
    openRegistrationOffset: option.openRegistrationOffset,
    organizingRegistration: option.organizingRegistration,
    price: option.price,
    registeredDescription: option.registeredDescription ?? null,
    registrationMode: option.registrationMode,
    roleIds: option.roleIds,
    roles: option.roleIds.flatMap((roleId) => {
      const role = rolesById.get(roleId);
      return role ? [{ id: role.id, name: role.name }] : [];
    }),
    spots: option.spots,
    stripeTaxRateId: option.stripeTaxRateId ?? null,
    title: option.title,
  })),
  title: template.title,
});

const financeReceiptView = {
  alcoholAmount: financeReceipts.alcoholAmount,
  attachmentFileName: financeReceipts.attachmentFileName,
  attachmentMimeType: financeReceipts.attachmentMimeType,
  attachmentStorageKey: financeReceipts.attachmentStorageKey,
  createdAt: financeReceipts.createdAt,
  depositAmount: financeReceipts.depositAmount,
  eventId: financeReceipts.eventId,
  hasAlcohol: financeReceipts.hasAlcohol,
  hasDeposit: financeReceipts.hasDeposit,
  id: financeReceipts.id,
  previewImageUrl: financeReceipts.previewImageUrl,
  purchaseCountry: financeReceipts.purchaseCountry,
  receiptDate: financeReceipts.receiptDate,
  refundedAt: financeReceipts.refundedAt,
  refundTransactionId: financeReceipts.refundTransactionId,
  rejectionReason: financeReceipts.rejectionReason,
  reviewedAt: financeReceipts.reviewedAt,
  status: financeReceipts.status,
  submittedByUserId: financeReceipts.submittedByUserId,
  taxAmount: financeReceipts.taxAmount,
  totalAmount: financeReceipts.totalAmount,
  updatedAt: financeReceipts.updatedAt,
} as const;

const normalizeFinanceReceiptBaseRecord = (receipt: {
  alcoholAmount: number;
  attachmentFileName: string;
  attachmentMimeType: string;
  attachmentStorageKey: null | string;
  createdAt: Date;
  depositAmount: number;
  eventId: string;
  hasAlcohol: boolean;
  hasDeposit: boolean;
  id: string;
  previewImageUrl: null | string;
  purchaseCountry: string;
  receiptDate: Date;
  refundedAt: Date | null;
  refundTransactionId: null | string;
  rejectionReason: null | string;
  reviewedAt: Date | null;
  status: 'approved' | 'refunded' | 'rejected' | 'submitted';
  submittedByUserId: string;
  taxAmount: number;
  totalAmount: number;
  updatedAt: Date;
}) => ({
  alcoholAmount: receipt.alcoholAmount,
  attachmentFileName: receipt.attachmentFileName,
  attachmentMimeType: receipt.attachmentMimeType,
  attachmentStorageKey: receipt.attachmentStorageKey ?? null,
  createdAt: receipt.createdAt.toISOString(),
  depositAmount: receipt.depositAmount,
  eventId: receipt.eventId,
  hasAlcohol: receipt.hasAlcohol,
  hasDeposit: receipt.hasDeposit,
  id: receipt.id,
  previewImageUrl: receipt.previewImageUrl ?? null,
  purchaseCountry: receipt.purchaseCountry,
  receiptDate: receipt.receiptDate.toISOString(),
  refundedAt: receipt.refundedAt?.toISOString() ?? null,
  refundTransactionId: receipt.refundTransactionId ?? null,
  rejectionReason: receipt.rejectionReason ?? null,
  reviewedAt: receipt.reviewedAt?.toISOString() ?? null,
  status: receipt.status,
  submittedByUserId: receipt.submittedByUserId,
  taxAmount: receipt.taxAmount,
  totalAmount: receipt.totalAmount,
  updatedAt: receipt.updatedAt.toISOString(),
});

const normalizeFinanceTransactionRecord = (transaction: {
  amount: number;
  appFee: null | number;
  comment: null | string;
  createdAt: Date;
  id: string;
  method: 'cash' | 'paypal' | 'stripe' | 'transfer';
  status: 'cancelled' | 'pending' | 'successful';
  stripeFee: null | number;
}) => ({
  amount: transaction.amount,
  appFee: transaction.appFee ?? null,
  comment: transaction.comment ?? null,
  createdAt: transaction.createdAt.toISOString(),
  id: transaction.id,
  method: transaction.method,
  status: transaction.status,
  stripeFee: transaction.stripeFee ?? null,
});

const normalizeRoleRecord = (
  role: Pick<
    typeof roles.$inferSelect,
    | 'collapseMembersInHup'
    | 'defaultOrganizerRole'
    | 'defaultUserRole'
    | 'description'
    | 'displayInHub'
    | 'id'
    | 'name'
    | 'permissions'
    | 'showInHub'
    | 'sortOrder'
  >,
): AdminRoleRecord => ({
  collapseMembersInHup: role.collapseMembersInHup,
  defaultOrganizerRole: role.defaultOrganizerRole,
  defaultUserRole: role.defaultUserRole,
  description: role.description ?? null,
  displayInHub: role.displayInHub,
  id: role.id,
  name: role.name,
  permissions: role.permissions,
  showInHub: role.showInHub,
  sortOrder: role.sortOrder,
});

const normalizeHubRoleRecord = (role: {
  description: null | string;
  id: string;
  name: string;
  usersToTenants: readonly {
    user: null | {
      firstName: string;
      id: string;
      lastName: string;
    };
  }[];
}): AdminHubRoleRecord => {
  const users = role.usersToTenants.flatMap((membership) =>
    membership.user ? [membership.user] : [],
  );

  return {
    description: role.description ?? null,
    id: role.id,
    name: role.name,
    userCount: users.length,
    users,
  };
};

const normalizeTenantTaxRateRecord = (
  taxRate: Pick<
    typeof tenantStripeTaxRates.$inferSelect,
    | 'active'
    | 'country'
    | 'displayName'
    | 'inclusive'
    | 'percentage'
    | 'state'
    | 'stripeTaxRateId'
  >,
) => ({
  active: taxRate.active,
  country: taxRate.country ?? null,
  displayName: taxRate.displayName ?? null,
  inclusive: taxRate.inclusive,
  percentage: taxRate.percentage ?? null,
  state: taxRate.state ?? null,
  stripeTaxRateId: taxRate.stripeTaxRateId,
});

const normalizeActiveTenantTaxRateRecord = (
  taxRate: Pick<
    typeof tenantStripeTaxRates.$inferSelect,
    | 'country'
    | 'displayName'
    | 'id'
    | 'percentage'
    | 'state'
    | 'stripeTaxRateId'
  >,
) => ({
  country: taxRate.country ?? null,
  displayName: taxRate.displayName ?? null,
  id: taxRate.id,
  percentage: taxRate.percentage ?? null,
  state: taxRate.state ?? null,
  stripeTaxRateId: taxRate.stripeTaxRateId,
});

const normalizeUserDiscountCardRecord = (
  card: Pick<
    typeof userDiscountCards.$inferSelect,
    'id' | 'identifier' | 'status' | 'type' | 'validTo'
  >,
) => ({
  id: card.id,
  identifier: card.identifier,
  status: card.status,
  type: card.type,
  validTo: card.validTo?.toISOString() ?? null,
});

const normalizeTemplatesByCategoryRecord = (
  templateCategory: Pick<
    typeof eventTemplateCategories.$inferSelect,
    'icon' | 'id' | 'title'
  > & {
    templates: readonly Pick<
      typeof eventTemplates.$inferSelect,
      'icon' | 'id' | 'title'
    >[];
  },
): TemplatesByCategoryRecord => ({
  icon: templateCategory.icon,
  id: templateCategory.id,
  templates: templateCategory.templates.map((template) =>
    normalizeTemplateRecord(template),
  ),
  title: templateCategory.title,
});

const getEsnCardDiscountedPriceByOptionId = (
  discounts: readonly {
    discountedPrice: number;
    discountType: string;
    registrationOptionId: string;
  }[],
) => {
  const map = new Map<string, number>();
  for (const discount of discounts) {
    if (discount.discountType !== 'esnCard') {
      continue;
    }

    const current = map.get(discount.registrationOptionId);
    if (current === undefined || discount.discountedPrice < current) {
      map.set(discount.registrationOptionId, discount.discountedPrice);
    }
  }

  return map;
};

const isEsnCardEnabled = (providers: unknown) => {
  if (!providers || typeof providers !== 'object') {
    return false;
  }

  const esnCard = (
    providers as {
      esnCard?: {
        status?: unknown;
      };
    }
  ).esnCard;

  return esnCard?.status === 'enabled';
};

const hasOrganizingRegistrationForEvent = (
  tenantId: string,
  user: { id: string; permissions: readonly string[] },
  eventId: string,
): Effect.Effect<boolean, never, Database> =>
  Effect.gen(function* () {
    const organizerRegistration = yield* dbEffect((database) =>
      database
        .select({
          id: eventRegistrations.id,
        })
        .from(eventRegistrations)
        .innerJoin(
          eventRegistrationOptions,
          eq(eventRegistrationOptions.id, eventRegistrations.registrationOptionId),
        )
        .where(
          and(
            eq(eventRegistrations.tenantId, tenantId),
            eq(eventRegistrations.userId, user.id),
            eq(eventRegistrations.eventId, eventId),
            eq(eventRegistrations.status, 'CONFIRMED'),
            eq(eventRegistrationOptions.organizingRegistration, true),
          ),
        )
        .limit(1),
    );

    return organizerRegistration.length > 0;
  });

const canViewEventReceipts = (
  tenantId: string,
  user: { id: string; permissions: readonly string[] },
  eventId: string,
): Effect.Effect<boolean, never, Database> => {
  if (
    user.permissions.includes('events:organizeAll') ||
    user.permissions.includes('finance:manageReceipts') ||
    user.permissions.includes('finance:approveReceipts') ||
    user.permissions.includes('finance:refundReceipts')
  ) {
    return Effect.succeed(true);
  }

  return hasOrganizingRegistrationForEvent(tenantId, user, eventId);
};

const canSubmitEventReceipts = (
  tenantId: string,
  user: { id: string; permissions: readonly string[] },
  eventId: string,
): Effect.Effect<boolean, never, Database> => {
  if (
    user.permissions.includes('events:organizeAll') ||
    user.permissions.includes('finance:manageReceipts')
  ) {
    return Effect.succeed(true);
  }

  return hasOrganizingRegistrationForEvent(tenantId, user, eventId);
};

const canEditEvent = ({
  creatorId,
  permissions,
  userId,
}: {
  creatorId: string;
  permissions: readonly string[];
  userId: string;
}) => creatorId === userId || permissions.includes('events:editAll');

const EDITABLE_EVENT_STATUSES = ['DRAFT', 'REJECTED'] as const;

type EventRegistrationOptionDiscountInsert =
  typeof eventRegistrationOptionDiscounts.$inferInsert;

const getFriendlyIconName = (
  icon: string,
): Effect.Effect<string, IconRpcError> =>
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
): Effect.Effect<void, 'UNAUTHORIZED'> =>
  headers[RPC_CONTEXT_HEADERS.AUTHENTICATED] === 'true'
    ? Effect.void
    : Effect.fail('UNAUTHORIZED' as const);

const ensurePermission = (
  headers: Headers.Headers,
  permission: Permission,
): Effect.Effect<void, 'FORBIDDEN' | 'UNAUTHORIZED'> =>
  Effect.gen(function* () {
    yield* ensureAuthenticated(headers);
    const currentPermissions = decodeHeaderJson(
      headers[RPC_CONTEXT_HEADERS.PERMISSIONS],
      ConfigPermissions,
    );

    if (!currentPermissions.includes(permission)) {
      return yield* Effect.fail('FORBIDDEN' as const);
    }
  });

const decodeUserHeader = (headers: Headers.Headers) =>
  Effect.sync(() =>
    decodeHeaderJson(headers[RPC_CONTEXT_HEADERS.USER], Schema.NullOr(User)),
  );

const decodeAuthDataHeader = (headers: Headers.Headers) =>
  decodeHeaderJson(headers[RPC_CONTEXT_HEADERS.AUTH_DATA], UsersAuthData);

const requireUserHeader = (
  headers: Headers.Headers,
): Effect.Effect<User, 'UNAUTHORIZED'> =>
  Effect.gen(function* () {
    const user = yield* decodeUserHeader(headers);
    if (!user) {
      return yield* Effect.fail('UNAUTHORIZED' as const);
    }
    return user;
  });

export const discountHandlers = {
    'discounts.deleteMyCard': (input, options) =>
      Effect.gen(function* () {
        yield* ensureAuthenticated(options.headers);
        const tenant = decodeHeaderJson(
          options.headers[RPC_CONTEXT_HEADERS.TENANT],
          Tenant,
        );
        const user = yield* requireUserHeader(options.headers);

        yield* dbEffect((database) =>
          database
            .delete(userDiscountCards)
            .where(
              and(
                eq(userDiscountCards.tenantId, tenant.id),
                eq(userDiscountCards.userId, user.id),
                eq(userDiscountCards.type, input.type),
              ),
            ),
        );
      }),
    'discounts.getMyCards': (_payload, options) =>
      Effect.gen(function* () {
        yield* ensureAuthenticated(options.headers);
        const tenant = decodeHeaderJson(
          options.headers[RPC_CONTEXT_HEADERS.TENANT],
          Tenant,
        );
        const user = yield* requireUserHeader(options.headers);
        const cards = yield* dbEffect((database) =>
          database.query.userDiscountCards.findMany({
            where: {
              tenantId: tenant.id,
              userId: user.id,
            },
          }),
        );

        return cards.map((card) => normalizeUserDiscountCardRecord(card));
      }),
    'discounts.getTenantProviders': (_payload, options) =>
      Effect.gen(function* () {
        yield* ensureAuthenticated(options.headers);
        const tenant = decodeHeaderJson(
          options.headers[RPC_CONTEXT_HEADERS.TENANT],
          Tenant,
        );
        const resolvedTenant = yield* dbEffect((database) =>
          database.query.tenants.findFirst({
            where: { id: tenant.id },
          }),
        );
        const config = resolveTenantDiscountProviders(
          resolvedTenant?.discountProviders,
        );

        return (Object.keys(PROVIDERS) as ProviderType[]).map((type) => ({
          config: normalizeEsnCardConfig(config[type].config),
          status: config[type].status,
          type,
        }));
      }),
    'discounts.refreshMyCard': (input, options) =>
      Effect.gen(function* () {
        yield* ensureAuthenticated(options.headers);
        const tenant = decodeHeaderJson(
          options.headers[RPC_CONTEXT_HEADERS.TENANT],
          Tenant,
        );
        const user = yield* requireUserHeader(options.headers);

        const tenantRecord = yield* dbEffect((database) =>
          database.query.tenants.findFirst({
            where: {
              id: tenant.id,
            },
          }),
        );
        const providers = resolveTenantDiscountProviders(
          tenantRecord?.discountProviders,
        );
        const provider = providers[input.type];
        if (!provider || provider.status !== 'enabled') {
          return yield* Effect.fail('FORBIDDEN' as const);
        }

        const card = yield* dbEffect((database) =>
          database.query.userDiscountCards.findFirst({
            where: {
              tenantId: tenant.id,
              type: input.type,
              userId: user.id,
            },
          }),
        );
        if (!card) {
          return yield* Effect.fail('NOT_FOUND' as const);
        }

        const adapter = Adapters[input.type];
        if (!adapter) {
          return normalizeUserDiscountCardRecord(card);
        }

        const result = yield* Effect.promise(() =>
          adapter.validate({
            config: provider.config,
            identifier: card.identifier,
          }),
        );
        const updatedCards = yield* dbEffect((database) =>
          database
            .update(userDiscountCards)
            .set({
              lastCheckedAt: new Date(),
              metadata: result.metadata,
              status: result.status,
              validFrom: result.validFrom ?? undefined,
              validTo: result.validTo ?? undefined,
            })
            .where(eq(userDiscountCards.id, card.id))
            .returning(),
        );
        const updatedCard = updatedCards[0];
        if (!updatedCard) {
          return yield* Effect.fail('NOT_FOUND' as const);
        }

        return normalizeUserDiscountCardRecord(updatedCard);
      }),
    'discounts.upsertMyCard': (input, options) =>
      Effect.gen(function* () {
        yield* ensureAuthenticated(options.headers);
        const tenant = decodeHeaderJson(
          options.headers[RPC_CONTEXT_HEADERS.TENANT],
          Tenant,
        );
        const user = yield* requireUserHeader(options.headers);

        const tenantRecord = yield* dbEffect((database) =>
          database.query.tenants.findFirst({
            where: {
              id: tenant.id,
            },
          }),
        );
        const providers = resolveTenantDiscountProviders(
          tenantRecord?.discountProviders,
        );
        const provider = providers[input.type];
        if (!provider || provider.status !== 'enabled') {
          return yield* Effect.fail('FORBIDDEN' as const);
        }

        const existingIdentifier = yield* dbEffect((database) =>
          database.query.userDiscountCards.findFirst({
            where: {
              identifier: input.identifier,
              type: input.type,
            },
          }),
        );
        if (existingIdentifier && existingIdentifier.userId !== user.id) {
          return yield* Effect.fail('CONFLICT' as const);
        }

        const existingCard = yield* dbEffect((database) =>
          database.query.userDiscountCards.findFirst({
            where: {
              tenantId: tenant.id,
              type: input.type,
              userId: user.id,
            },
          }),
        );

        const upsertedCards = existingCard
          ? yield* dbEffect((database) =>
          database
                .update(userDiscountCards)
                .set({
                  identifier: input.identifier,
                })
                .where(eq(userDiscountCards.id, existingCard.id))
                .returning(),
            )
          : yield* dbEffect((database) =>
          database
                .insert(userDiscountCards)
                .values({
                  identifier: input.identifier,
                  tenantId: tenant.id,
                  type: input.type,
                  userId: user.id,
                })
                .returning(),
            );
        const upsertedCard = upsertedCards[0];
        if (!upsertedCard) {
          return yield* Effect.fail('BAD_REQUEST' as const);
        }

        const adapter = Adapters[input.type];
        if (!adapter) {
          return normalizeUserDiscountCardRecord(upsertedCard);
        }

        const result = yield* Effect.promise(() =>
          adapter.validate({
            config: provider.config,
            identifier: input.identifier,
          }),
        );
        const updatedCards = yield* dbEffect((database) =>
          database
            .update(userDiscountCards)
            .set({
              lastCheckedAt: new Date(),
              metadata: result.metadata,
              status: result.status,
              validFrom: result.validFrom ?? undefined,
              validTo: result.validTo ?? undefined,
            })
            .where(eq(userDiscountCards.id, upsertedCard.id))
            .returning(),
        );
        const updatedCard = updatedCards[0];
        if (!updatedCard) {
          return yield* Effect.fail('BAD_REQUEST' as const);
        }

        if (updatedCard.status !== 'verified') {
          return yield* Effect.fail('BAD_REQUEST' as const);
        }

        return normalizeUserDiscountCardRecord(updatedCard);
      }),
} satisfies Partial<AppRpcHandlers>;
