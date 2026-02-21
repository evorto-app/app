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
import { EventRegistrationService } from './events/event-registration.service';
import { mapEventRegistrationErrorToRpc } from '../shared/rpc-error-mappers';

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

export const eventHandlers = {
    'events.cancelPendingRegistration': ({ registrationId }, options) =>
      Effect.gen(function* () {
        yield* ensureAuthenticated(options.headers);
        const tenant = decodeHeaderJson(
          options.headers[RPC_CONTEXT_HEADERS.TENANT],
          Tenant,
        );
        const user = yield* requireUserHeader(options.headers);

        const registration = yield* dbEffect((database) =>
          database.query.eventRegistrations.findFirst({
            where: {
              id: registrationId,
              status: 'PENDING',
              tenantId: tenant.id,
              userId: user.id,
            },
            with: {
              registrationOption: true,
              transactions: true,
            },
          }),
        );

        if (!registration) {
          return yield* Effect.fail('NOT_FOUND' as const);
        }

        yield* dbEffect((database) =>
          database.transaction((tx) =>
            Effect.gen(function* () {
              yield* tx
                .update(eventRegistrations)
                .set({
                  status: 'CANCELLED',
                })
                .where(eq(eventRegistrations.id, registration.id));

              const reservedSpots =
                registration.registrationOption?.reservedSpots;
              if (reservedSpots === undefined) {
                return yield* Effect.fail(
                  new Error('Registration option missing'),
                );
              }

              yield* tx
                .update(eventRegistrationOptions)
                .set({
                  reservedSpots: reservedSpots - 1,
                })
                .where(
                  eq(
                    eventRegistrationOptions.id,
                    registration.registrationOptionId,
                  ),
                );

              const transaction = registration.transactions.find(
                (currentTransaction) =>
                  currentTransaction.status === 'pending' &&
                  currentTransaction.method === 'stripe',
              );

              if (!transaction) {
                return;
              }

              yield* tx
                .update(transactions)
                .set({
                  status: 'cancelled',
                })
                .where(eq(transactions.id, transaction.id));

              const stripeCheckoutSessionId = transaction.stripeCheckoutSessionId;
              if (!stripeCheckoutSessionId) {
                return;
              }

              const stripeAccount = tenant.stripeAccountId;
              if (!stripeAccount) {
                return yield* Effect.fail(new Error('Stripe account not found'));
              }
              yield* Effect.tryPromise(() =>
                stripe.checkout.sessions.expire(
                  stripeCheckoutSessionId,
                  undefined,
                  {
                    stripeAccount,
                  },
                ),
              ).pipe(Effect.catchAll(() => Effect.void));
            }),
          ),
        ).pipe(Effect.mapError(() => 'INTERNAL_SERVER_ERROR' as const));
      }),
    'events.canOrganize': ({ eventId }, options) =>
      Effect.gen(function* () {
        yield* ensureAuthenticated(options.headers);
        const tenant = decodeHeaderJson(
          options.headers[RPC_CONTEXT_HEADERS.TENANT],
          Tenant,
        );
        const user = yield* requireUserHeader(options.headers);

        if (
          user.permissions.includes('events:organizeAll') ||
          user.permissions.includes('finance:manageReceipts')
        ) {
          return true;
        }

        const registrations = yield* dbEffect((database) =>
          database
            .select({
              id: eventRegistrations.id,
            })
            .from(eventRegistrations)
            .innerJoin(
              eventRegistrationOptions,
              eq(
                eventRegistrations.registrationOptionId,
                eventRegistrationOptions.id,
              ),
            )
            .where(
              and(
                eq(eventRegistrations.tenantId, tenant.id),
                eq(eventRegistrations.eventId, eventId),
                eq(eventRegistrations.userId, user.id),
                eq(eventRegistrations.status, 'CONFIRMED'),
                eq(eventRegistrationOptions.organizingRegistration, true),
              ),
            )
            .limit(1),
        );

        return registrations.length > 0;
      }),
    'events.create': (input, options) =>
      Effect.gen(function* () {
        yield* ensurePermission(options.headers, 'events:create');
        const tenant = decodeHeaderJson(
          options.headers[RPC_CONTEXT_HEADERS.TENANT],
          Tenant,
        );
        const user = yield* requireUserHeader(options.headers);

        const start = new Date(input.start);
        const end = new Date(input.end);
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
          return yield* Effect.fail('BAD_REQUEST' as const);
        }

        const sanitizedDescription = sanitizeRichTextHtml(input.description);
        if (!isMeaningfulRichTextHtml(sanitizedDescription)) {
          return yield* Effect.fail('BAD_REQUEST' as const);
        }

        const sanitizedRegistrationOptions = input.registrationOptions.map(
          (option) => ({
            ...option,
            closeRegistrationTime: new Date(option.closeRegistrationTime),
            description: sanitizeOptionalRichTextHtml(option.description),
            openRegistrationTime: new Date(option.openRegistrationTime),
            registeredDescription: sanitizeOptionalRichTextHtml(
              option.registeredDescription,
            ),
          }),
        );

        for (const option of sanitizedRegistrationOptions) {
          if (
            Number.isNaN(option.closeRegistrationTime.getTime()) ||
            Number.isNaN(option.openRegistrationTime.getTime())
          ) {
            return yield* Effect.fail('BAD_REQUEST' as const);
          }

          const validation = yield* dbEffect((database) =>
            validateTaxRate(database, {
              isPaid: option.isPaid,
              stripeTaxRateId: option.stripeTaxRateId ?? null,
              tenantId: tenant.id,
            }),
          );
          if (!validation.success) {
            return yield* Effect.fail('BAD_REQUEST' as const);
          }
        }

        const templateDefaults = yield* dbEffect((database) =>
          database.query.eventTemplates.findFirst({
            columns: { unlisted: true },
            where: { id: input.templateId },
          }),
        );

        const events = yield* dbEffect((database) =>
          database
            .insert(eventInstances)
            .values({
              creatorId: user.id,
              description: sanitizedDescription,
              end,
              icon: input.icon,
              start,
              templateId: input.templateId,
              tenantId: tenant.id,
              title: input.title,
              unlisted: templateDefaults?.unlisted ?? false,
            })
            .returning({
              id: eventInstances.id,
            }),
        );
        const event = events[0];
        if (!event) {
          return yield* Effect.fail('INTERNAL_SERVER_ERROR' as const);
        }

        const createdOptions = yield* dbEffect((database) =>
          database
            .insert(eventRegistrationOptions)
            .values(
              sanitizedRegistrationOptions.map((option) => ({
                closeRegistrationTime: option.closeRegistrationTime,
                description: option.description,
                eventId: event.id,
                isPaid: option.isPaid,
                openRegistrationTime: option.openRegistrationTime,
                organizingRegistration: option.organizingRegistration,
                price: option.price,
                registeredDescription: option.registeredDescription,
                registrationMode: option.registrationMode,
                roleIds: [...option.roleIds],
                spots: option.spots,
                stripeTaxRateId: option.stripeTaxRateId ?? null,
                title: option.title,
              })),
            )
            .returning({
              id: eventRegistrationOptions.id,
              organizingRegistration:
                eventRegistrationOptions.organizingRegistration,
              title: eventRegistrationOptions.title,
            }),
        );

        const tenantTemplateOptions = yield* dbEffect((database) =>
          database.query.templateRegistrationOptions.findMany({
            where: { templateId: input.templateId },
          }),
        );
        if (tenantTemplateOptions.length > 0) {
          const templateDiscounts = yield* dbEffect((database) =>
          database
              .select()
              .from(templateRegistrationOptionDiscounts)
              .where(
                inArray(
                  templateRegistrationOptionDiscounts.registrationOptionId,
                  tenantTemplateOptions.map((option) => option.id),
                ),
              ),
          );
          if (templateDiscounts.length > 0) {
            const registrationOptionKey = (
              title: string,
              organizing: boolean,
            ) => `${title}__${organizing ? '1' : '0'}`;
            const templateOptionByKey = new Map(
              tenantTemplateOptions.map((option) => [
                registrationOptionKey(
                  option.title,
                  option.organizingRegistration,
                ),
                option,
              ]),
            );
            const discountInserts: EventRegistrationOptionDiscountInsert[] = [];
            for (const createdOption of createdOptions) {
              const sourceTemplateOption = templateOptionByKey.get(
                registrationOptionKey(
                  createdOption.title,
                  createdOption.organizingRegistration,
                ),
              );
              if (!sourceTemplateOption) {
                continue;
              }
              for (const discount of templateDiscounts) {
                if (discount.registrationOptionId !== sourceTemplateOption.id) {
                  continue;
                }
                discountInserts.push({
                  discountedPrice: discount.discountedPrice,
                  discountType: discount.discountType,
                  registrationOptionId: createdOption.id,
                });
              }
            }
            if (discountInserts.length > 0) {
              yield* dbEffect((database) =>
          database
                  .insert(eventRegistrationOptionDiscounts)
                  .values(discountInserts),
              );
            }
          }
        }

        return {
          id: event.id,
        };
      }),
    'events.eventList': (input, options) =>
      Effect.gen(function* () {
        const tenant = decodeHeaderJson(
          options.headers[RPC_CONTEXT_HEADERS.TENANT],
          Tenant,
        );
        const user = yield* decodeUserHeader(options.headers);
        const userPermissions = user?.permissions ?? [];

        if (user?.id !== input.userId) {
          yield* Effect.logWarning(
            'Supplied query parameter userId does not match authenticated user',
          ).pipe(
            Effect.annotateLogs({
              actualUserId: user?.id ?? null,
              suppliedUserId: input.userId,
            }),
          );
        }

        const onlyApprovedStatus =
          input.status.length === 1 && input.status[0] === 'APPROVED';
        if (
          !onlyApprovedStatus &&
          !userPermissions.includes('events:seeDrafts')
        ) {
          return yield* Effect.fail('FORBIDDEN' as const);
        }

        if (
          input.includeUnlisted &&
          !userPermissions.includes('events:seeUnlisted')
        ) {
          return yield* Effect.fail('FORBIDDEN' as const);
        }

        const rolesToFilterBy =
          user?.roleIds ??
          (yield* dbEffect((database) =>
            database.query.roles
              .findMany({
                columns: { id: true },
                where: {
                  defaultUserRole: true,
                  tenantId: tenant.id,
                },
              })
              .pipe(Effect.map((roleRecords) => roleRecords.map((role) => role.id))),
          ));
        const roleFilters =
          rolesToFilterBy.length > 0 ? [...rolesToFilterBy] : [''];

        const selectedEvents = yield* dbEffect((database) =>
          database
            .select({
              creatorId: eventInstances.creatorId,
              icon: eventInstances.icon,
              id: eventInstances.id,
              start: eventInstances.start,
              status: eventInstances.status,
              title: eventInstances.title,
              unlisted: eventInstances.unlisted,
              userRegistered: exists(
                database
                  .select()
                  .from(eventRegistrations)
                  .where(
                    and(
                      eq(eventRegistrations.eventId, eventInstances.id),
                      eq(eventRegistrations.userId, user?.id ?? ''),
                      not(eq(eventRegistrations.status, 'CANCELLED')),
                    ),
                  ),
              ),
            })
            .from(eventInstances)
            .where(
              and(
                gt(eventInstances.start, new Date(input.startAfter)),
                eq(eventInstances.tenantId, tenant.id),
                inArray(eventInstances.status, [...input.status]),
                ...(input.includeUnlisted
                  ? []
                  : [eq(eventInstances.unlisted, false)]),
                exists(
                  database
                    .select()
                    .from(eventRegistrationOptions)
                    .where(
                      and(
                        eq(eventRegistrationOptions.eventId, eventInstances.id),
                        arrayOverlaps(
                          eventRegistrationOptions.roleIds,
                          roleFilters,
                        ),
                      ),
                    ),
                ),
              ),
            )
            .limit(input.limit)
            .offset(input.offset)
            .orderBy(eventInstances.start),
        );

        const eventRecords = selectedEvents.map((event) => ({
          icon: event.icon,
          id: event.id,
          start: event.start.toISOString(),
          status: event.status,
          title: event.title,
          unlisted: event.unlisted,
          userIsCreator: event.creatorId === (user?.id ?? 'not'),
          userRegistered: Boolean(event.userRegistered),
        }));

        const groupedEvents = new Map<string, typeof eventRecords>();

        for (const event of eventRecords) {
          const day = DateTime.fromISO(event.start).toFormat('yyyy-MM-dd');
          const currentEvents = groupedEvents.get(day) ?? [];
          currentEvents.push(event);
          groupedEvents.set(day, currentEvents);
        }

        return [...groupedEvents.entries()].map(([day, events]) => ({
          day: DateTime.fromFormat(day, 'yyyy-MM-dd').toJSDate().toISOString(),
          events,
        }));
      }),
    'events.findOne': ({ id }, options) =>
      Effect.gen(function* () {
        const tenant = decodeHeaderJson(
          options.headers[RPC_CONTEXT_HEADERS.TENANT],
          Tenant,
        );
        const user = yield* decodeUserHeader(options.headers);

        const rolesToFilterBy =
          user?.roleIds ??
          (yield* dbEffect((database) =>
            database.query.roles
              .findMany({
                columns: { id: true },
                where: {
                  defaultUserRole: true,
                  tenantId: tenant.id,
                },
              })
              .pipe(Effect.map((roleRecords) => roleRecords.map((role) => role.id))),
          ));

        const event = yield* dbEffect((database) =>
          database.query.eventInstances.findFirst({
            where: { id, tenantId: tenant.id },
            with: {
              registrationOptions: {
                where: {
                  RAW: (table) =>
                    arrayOverlaps(table.roleIds, [...rolesToFilterBy]),
                },
              },
              reviewer: {
                columns: {
                  firstName: true,
                  lastName: true,
                },
              },
            },
          }),
        );
        if (!event) {
          return yield* Effect.fail('NOT_FOUND' as const);
        }

        const canSeeDrafts = user?.permissions.includes('events:seeDrafts');
        const canReviewEvents = user?.permissions.includes('events:review');
        const canEditEvent_ = user
          ? canEditEvent({
              creatorId: event.creatorId,
              permissions: user.permissions,
              userId: user.id,
            })
          : false;
        if (
          event.status !== 'APPROVED' &&
          !canSeeDrafts &&
          !canReviewEvents &&
          !canEditEvent_
        ) {
          return yield* Effect.fail('NOT_FOUND' as const);
        }

        const registrationOptionIds = event.registrationOptions.map(
          (registrationOption) => registrationOption.id,
        );
        const optionDiscounts =
          registrationOptionIds.length === 0
            ? []
            : yield* dbEffect((database) =>
          database
                  .select()
                  .from(eventRegistrationOptionDiscounts)
                  .where(
                    and(
                      eq(
                        eventRegistrationOptionDiscounts.discountType,
                        'esnCard',
                      ),
                      inArray(
                        eventRegistrationOptionDiscounts.registrationOptionId,
                        registrationOptionIds,
                      ),
                    ),
                  ),
              );
        const esnCardDiscountedPriceByOptionId =
          getEsnCardDiscountedPriceByOptionId(optionDiscounts);

        const esnCardIsEnabledForTenant = isEsnCardEnabled(
          tenant.discountProviders ?? null,
        );
        let userCanUseEsnCardDiscount = false;

        if (user && esnCardIsEnabledForTenant) {
          const cards = yield* dbEffect((database) =>
          database.query.userDiscountCards.findMany({
              where: {
                status: 'verified',
                tenantId: tenant.id,
                type: 'esnCard',
                userId: user.id,
              },
            }),
          );
          userCanUseEsnCardDiscount = cards.some(
            (card) => !card.validTo || card.validTo > event.start,
          );
        }

        return {
          creatorId: event.creatorId,
          description: event.description,
          end: event.end.toISOString(),
          icon: event.icon,
          id: event.id,
          location: event.location ?? null,
          registrationOptions: event.registrationOptions.map(
            (registrationOption) => {
              const esnCardDiscountedPrice =
                esnCardDiscountedPriceByOptionId.get(registrationOption.id) ??
                null;
              const userIsEligibleForEsnCardDiscount =
                registrationOption.isPaid &&
                esnCardDiscountedPrice !== null &&
                esnCardIsEnabledForTenant &&
                userCanUseEsnCardDiscount;
              const effectivePrice = userIsEligibleForEsnCardDiscount
                ? Math.min(registrationOption.price, esnCardDiscountedPrice)
                : registrationOption.price;
              const discountApplied =
                userIsEligibleForEsnCardDiscount &&
                effectivePrice < registrationOption.price;

              return {
                appliedDiscountType: discountApplied
                  ? ('esnCard' as const)
                  : null,
                checkedInSpots: registrationOption.checkedInSpots,
                closeRegistrationTime:
                  registrationOption.closeRegistrationTime.toISOString(),
                confirmedSpots: registrationOption.confirmedSpots,
                description: registrationOption.description ?? null,
                discountApplied,
                effectivePrice,
                esnCardDiscountedPrice: discountApplied
                  ? esnCardDiscountedPrice
                  : null,
                eventId: registrationOption.eventId,
                id: registrationOption.id,
                isPaid: registrationOption.isPaid,
                openRegistrationTime:
                  registrationOption.openRegistrationTime.toISOString(),
                organizingRegistration:
                  registrationOption.organizingRegistration,
                price: registrationOption.price,
                registeredDescription:
                  registrationOption.registeredDescription ?? null,
                registrationMode: registrationOption.registrationMode,
                roleIds: [...registrationOption.roleIds],
                spots: registrationOption.spots,
                stripeTaxRateId: registrationOption.stripeTaxRateId ?? null,
                title: registrationOption.title,
              };
            },
          ),
          reviewer: event.reviewer,
          start: event.start.toISOString(),
          status: event.status,
          statusComment: event.statusComment ?? null,
          title: event.title,
          unlisted: event.unlisted,
        };
      }),
    'events.findOneForEdit': ({ id }, options) =>
      Effect.gen(function* () {
        yield* ensureAuthenticated(options.headers);
        const tenant = decodeHeaderJson(
          options.headers[RPC_CONTEXT_HEADERS.TENANT],
          Tenant,
        );
        const user = yield* requireUserHeader(options.headers);

        const event = yield* dbEffect((database) =>
          database.query.eventInstances.findFirst({
            where: { id, tenantId: tenant.id },
            with: {
              registrationOptions: true,
            },
          }),
        );

        if (!event) {
          return yield* Effect.fail('NOT_FOUND' as const);
        }

        const canEdit =
          event.creatorId === user.id ||
          user.permissions.includes('events:editAll');
        if (!canEdit) {
          return yield* Effect.fail('FORBIDDEN' as const);
        }

        if (event.status !== 'DRAFT' && event.status !== 'REJECTED') {
          return yield* Effect.fail('CONFLICT' as const);
        }

        const registrationOptionIds = event.registrationOptions.map(
          (option) => option.id,
        );
        const optionDiscounts =
          registrationOptionIds.length === 0
            ? []
            : yield* dbEffect((database) =>
          database
                  .select({
                    discountedPrice:
                      eventRegistrationOptionDiscounts.discountedPrice,
                    discountType: eventRegistrationOptionDiscounts.discountType,
                    registrationOptionId:
                      eventRegistrationOptionDiscounts.registrationOptionId,
                  })
                  .from(eventRegistrationOptionDiscounts)
                  .where(
                    and(
                      eq(
                        eventRegistrationOptionDiscounts.discountType,
                        'esnCard',
                      ),
                      inArray(
                        eventRegistrationOptionDiscounts.registrationOptionId,
                        [...registrationOptionIds],
                      ),
                    ),
                  ),
              );
        const esnCardDiscountedPriceByOptionId =
          getEsnCardDiscountedPriceByOptionId(optionDiscounts);

        return {
          description: event.description,
          end: event.end.toISOString(),
          icon: event.icon,
          id: event.id,
          location: event.location ?? null,
          registrationOptions: event.registrationOptions.map((option) => ({
            closeRegistrationTime: option.closeRegistrationTime.toISOString(),
            description: option.description ?? null,
            esnCardDiscountedPrice:
              esnCardDiscountedPriceByOptionId.get(option.id) ?? undefined,
            id: option.id,
            isPaid: option.isPaid,
            openRegistrationTime: option.openRegistrationTime.toISOString(),
            organizingRegistration: option.organizingRegistration,
            price: option.price,
            registeredDescription: option.registeredDescription ?? null,
            registrationMode: option.registrationMode,
            roleIds: [...option.roleIds],
            spots: option.spots,
            stripeTaxRateId: option.stripeTaxRateId ?? null,
            title: option.title,
          })),
          start: event.start.toISOString(),
          title: event.title,
        };
      }),
    'events.getOrganizeOverview': ({ eventId }, options) =>
      Effect.gen(function* () {
        yield* ensureAuthenticated(options.headers);
        const tenant = decodeHeaderJson(
          options.headers[RPC_CONTEXT_HEADERS.TENANT],
          Tenant,
        );

        const registrations = yield* dbEffect((database) =>
          database.query.eventRegistrations.findMany({
            where: {
              eventId,
              status: 'CONFIRMED',
              tenantId: tenant.id,
            },
            with: {
              registrationOption: {
                columns: {
                  id: true,
                  organizingRegistration: true,
                  price: true,
                  title: true,
                },
              },
              transactions: {
                columns: {
                  amount: true,
                },
                where: {
                  type: 'registration',
                },
              },
              user: {
                columns: {
                  email: true,
                  firstName: true,
                  id: true,
                  lastName: true,
                },
              },
            },
          }),
        );
        const registrationsWithRelations = registrations.filter(
          (registration) =>
            registration.registrationOption && registration.user,
        );

        type Registration = (typeof registrationsWithRelations)[number];
        const groupedRegistrations = groupBy(
          registrationsWithRelations,
          (registration) => registration.registrationOptionId,
        ) as Record<string, Registration[]>;

        const sortedOptions = (
          Object.entries(groupedRegistrations) as [string, Registration[]][]
        ).toSorted(([, registrationsA], [, registrationsB]) => {
          if (
            registrationsA[0].registrationOption.organizingRegistration !==
            registrationsB[0].registrationOption.organizingRegistration
          ) {
            return registrationsB[0].registrationOption.organizingRegistration
              ? 1
              : -1;
          }

          return registrationsA[0].registrationOption.title.localeCompare(
            registrationsB[0].registrationOption.title,
          );
        });

        return sortedOptions.map(([registrationOptionId, registrationRows]) => {
          const sortedUsers = registrationRows
            .toSorted((registrationA, registrationB) => {
              if (
                (registrationA.checkInTime === null) !==
                (registrationB.checkInTime === null)
              ) {
                return registrationA.checkInTime === null ? -1 : 1;
              }

              const firstNameCompare =
                registrationA.user.firstName.localeCompare(
                  registrationB.user.firstName,
                );
              if (firstNameCompare !== 0) {
                return firstNameCompare;
              }

              return registrationA.user.lastName.localeCompare(
                registrationB.user.lastName,
              );
            })
            .map((registration) => {
              const registrationOption = registration.registrationOption;
              const discountedPriceFromTransaction =
                registration.transactions.find(
                  (transaction) =>
                    transaction.amount < registrationOption.price,
                )?.amount;
              const appliedDiscountedPrice =
                registration.appliedDiscountedPrice ??
                discountedPriceFromTransaction ??
                null;
              const appliedDiscountType =
                registration.appliedDiscountType ??
                (appliedDiscountedPrice === null ? null : ('esnCard' as const));
              const basePriceAtRegistration =
                registration.basePriceAtRegistration ??
                (appliedDiscountedPrice === null
                  ? null
                  : registrationOption.price);
              const discountAmount =
                registration.discountAmount ??
                (appliedDiscountedPrice === null
                  ? null
                  : registrationOption.price - appliedDiscountedPrice);

              return {
                appliedDiscountedPrice,
                appliedDiscountType,
                basePriceAtRegistration,
                checkedIn: registration.checkInTime !== null,
                checkInTime: registration.checkInTime?.toISOString() ?? null,
                discountAmount,
                email: registration.user.email,
                firstName: registration.user.firstName,
                lastName: registration.user.lastName,
                userId: registration.user.id,
              };
            });

          return {
            organizingRegistration:
              registrationRows[0].registrationOption.organizingRegistration,
            registrationOptionId,
            registrationOptionTitle:
              registrationRows[0].registrationOption.title,
            users: sortedUsers,
          };
        });
      }),
    'events.getPendingReviews': (_payload, options) =>
      Effect.gen(function* () {
        yield* ensurePermission(options.headers, 'events:review');
        const tenant = decodeHeaderJson(
          options.headers[RPC_CONTEXT_HEADERS.TENANT],
          Tenant,
        );

        const pendingReviews = yield* dbEffect((database) =>
          database.query.eventInstances.findMany({
            columns: {
              id: true,
              start: true,
              title: true,
            },
            orderBy: { start: 'desc' },
            where: { status: 'PENDING_REVIEW', tenantId: tenant.id },
          }),
        );

        return pendingReviews.map((event) => ({
          id: event.id,
          start: event.start.toISOString(),
          title: event.title,
        }));
      }),
    'events.getRegistrationStatus': ({ eventId }, options) =>
      Effect.gen(function* () {
        const tenant = decodeHeaderJson(
          options.headers[RPC_CONTEXT_HEADERS.TENANT],
          Tenant,
        );
        const user = yield* decodeUserHeader(options.headers);
        if (!user) {
          return {
            isRegistered: false,
            registrations: [],
          };
        }

        const registrations = yield* dbEffect((database) =>
          database.query.eventRegistrations.findMany({
            where: {
              eventId,
              status: {
                NOT: 'CANCELLED',
              },
              tenantId: tenant.id,
              userId: user.id,
            },
            with: {
              registrationOption: true,
              transactions: true,
            },
          }),
        );

        const registrationSummaries = registrations.map((registration) => {
          const registrationOption = registration.registrationOption;
          if (!registrationOption) {
            throw new Error(
              `Registration option missing for registration ${registration.id}`,
            );
          }

          const registrationTransaction = registration.transactions.find(
            (transaction) =>
              transaction.type === 'registration' &&
              transaction.amount < registrationOption.price,
          );

          const discountedPrice =
            registration.appliedDiscountedPrice ??
            registrationTransaction?.amount ??
            undefined;
          const appliedDiscountType =
            registration.appliedDiscountType ??
            (discountedPrice === undefined ? undefined : ('esnCard' as const));
          const basePriceAtRegistration =
            registration.basePriceAtRegistration ??
            (discountedPrice === undefined
              ? undefined
              : registrationOption.price);
          const discountAmount =
            registration.discountAmount ??
            (discountedPrice === undefined
              ? undefined
              : registrationOption.price - discountedPrice);

          return {
            appliedDiscountedPrice: discountedPrice,
            appliedDiscountType,
            basePriceAtRegistration,
            checkoutUrl: registration.transactions.find(
              (transaction) =>
                transaction.method === 'stripe' &&
                transaction.type === 'registration',
            )?.stripeCheckoutUrl,
            discountAmount,
            id: registration.id,
            paymentPending: registration.transactions.some(
              (transaction) =>
                transaction.status === 'pending' &&
                transaction.type === 'registration',
            ),
            registeredDescription: registrationOption.registeredDescription,
            registrationOptionId: registration.registrationOptionId,
            registrationOptionTitle: registrationOption.title,
            status: registration.status,
          };
        });

        return {
          isRegistered: registrations.length > 0,
          registrations: registrationSummaries,
        };
      }),
    'events.registerForEvent': ({ eventId, registrationOptionId }, options) =>
      Effect.gen(function* () {
        yield* ensureAuthenticated(options.headers);
        const tenant = decodeHeaderJson(
          options.headers[RPC_CONTEXT_HEADERS.TENANT],
          Tenant,
        );
        const user = yield* requireUserHeader(options.headers);

        return yield* EventRegistrationService.registerForEvent({
          eventId,
          headers: options.headers,
          registrationOptionId,
          tenant: {
            currency: tenant.currency,
            id: tenant.id,
            stripeAccountId: tenant.stripeAccountId,
          },
          user: {
            email: user.email,
            id: user.id,
          },
        }).pipe(
          Effect.catchAll((error) =>
            Effect.fail(mapEventRegistrationErrorToRpc(error)),
          ),
        );
      }),
    'events.registrationScanned': ({ registrationId }, options) =>
      Effect.gen(function* () {
        yield* ensureAuthenticated(options.headers);
        const tenant = decodeHeaderJson(
          options.headers[RPC_CONTEXT_HEADERS.TENANT],
          Tenant,
        );
        const user = yield* requireUserHeader(options.headers);

        const registration = yield* dbEffect((database) =>
          database.query.eventRegistrations.findFirst({
            where: { id: registrationId, tenantId: tenant.id },
            with: {
              event: {
                columns: {
                  start: true,
                  title: true,
                },
              },
              registrationOption: {
                columns: {
                  price: true,
                  title: true,
                },
              },
              transactions: {
                columns: {
                  amount: true,
                },
                where: {
                  type: 'registration',
                },
              },
              user: {
                columns: {
                  firstName: true,
                  lastName: true,
                },
              },
            },
          }),
        );
        if (!registration || !registration.user || !registration.event) {
          return yield* Effect.fail('NOT_FOUND' as const);
        }

        const sameUserIssue = registration.userId === user.id;
        const registrationStatusIssue = registration.status !== 'CONFIRMED';
        const allowCheckin = !registrationStatusIssue && !sameUserIssue;
        const discountedTransaction = registration.transactions.find(
          (transaction) =>
            transaction.amount < registration.registrationOption.price,
        );
        const appliedDiscountedPrice =
          registration.appliedDiscountedPrice ??
          discountedTransaction?.amount ??
          null;
        const appliedDiscountType =
          registration.appliedDiscountType ??
          (appliedDiscountedPrice === null ? null : ('esnCard' as const));

        return {
          allowCheckin,
          appliedDiscountType,
          event: {
            start: registration.event.start.toISOString(),
            title: registration.event.title,
          },
          registrationOption: {
            title: registration.registrationOption.title,
          },
          registrationStatusIssue,
          sameUserIssue,
          user: {
            firstName: registration.user.firstName,
            lastName: registration.user.lastName,
          },
        };
      }),
    'events.reviewEvent': ({ approved, comment, eventId }, options) =>
      Effect.gen(function* () {
        yield* ensurePermission(options.headers, 'events:review');
        const tenant = decodeHeaderJson(
          options.headers[RPC_CONTEXT_HEADERS.TENANT],
          Tenant,
        );
        const user = yield* requireUserHeader(options.headers);

        const reviewedEvents = yield* dbEffect((database) =>
          database
            .update(eventInstances)
            .set({
              reviewedAt: new Date(),
              reviewedBy: user.id,
              status: approved ? 'APPROVED' : 'REJECTED',
              statusComment: comment || null,
            })
            .where(
              and(
                eq(eventInstances.id, eventId),
                eq(eventInstances.tenantId, tenant.id),
                eq(eventInstances.status, 'PENDING_REVIEW'),
              ),
            )
            .returning({
              id: eventInstances.id,
            }),
        );
        if (reviewedEvents.length > 0) {
          return;
        }

        const event = yield* dbEffect((database) =>
          database.query.eventInstances.findFirst({
            columns: { id: true },
            where: {
              id: eventId,
              tenantId: tenant.id,
            },
          }),
        );
        if (!event) {
          return yield* Effect.fail('NOT_FOUND' as const);
        }

        return yield* Effect.fail('CONFLICT' as const);
      }),
    'events.submitForReview': ({ eventId }, options) =>
      Effect.gen(function* () {
        yield* ensureAuthenticated(options.headers);
        const tenant = decodeHeaderJson(
          options.headers[RPC_CONTEXT_HEADERS.TENANT],
          Tenant,
        );
        const user = yield* requireUserHeader(options.headers);

        const event = yield* dbEffect((database) =>
          database.query.eventInstances.findFirst({
            columns: {
              creatorId: true,
              id: true,
              status: true,
            },
            where: {
              id: eventId,
              tenantId: tenant.id,
            },
          }),
        );
        if (!event) {
          return yield* Effect.fail('NOT_FOUND' as const);
        }

        if (
          !canEditEvent({
            creatorId: event.creatorId,
            permissions: user.permissions,
            userId: user.id,
          })
        ) {
          return yield* Effect.fail('FORBIDDEN' as const);
        }
        if (event.status !== 'DRAFT' && event.status !== 'REJECTED') {
          return yield* Effect.fail('CONFLICT' as const);
        }

        const submittedEvents = yield* dbEffect((database) =>
          database
            .update(eventInstances)
            .set({
              reviewedAt: null,
              reviewedBy: null,
              status: 'PENDING_REVIEW',
              statusComment: null,
            })
            .where(
              and(
                eq(eventInstances.id, eventId),
                eq(eventInstances.tenantId, tenant.id),
                inArray(eventInstances.status, ['DRAFT', 'REJECTED']),
              ),
            )
            .returning({
              id: eventInstances.id,
            }),
        );
        if (submittedEvents.length > 0) {
          return;
        }

        return yield* Effect.fail('CONFLICT' as const);
      }),
    'events.update': (input, options) =>
      Effect.gen(function* () {
        yield* ensureAuthenticated(options.headers);
        const tenant = decodeHeaderJson(
          options.headers[RPC_CONTEXT_HEADERS.TENANT],
          Tenant,
        );
        const user = yield* requireUserHeader(options.headers);

        const start = new Date(input.start);
        const end = new Date(input.end);
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
          return yield* Effect.fail('BAD_REQUEST' as const);
        }

        const sanitizedDescription = sanitizeRichTextHtml(input.description);
        if (!isMeaningfulRichTextHtml(sanitizedDescription)) {
          return yield* Effect.fail('BAD_REQUEST' as const);
        }
        const sanitizedRegistrationOptions = input.registrationOptions.map(
          (option) => ({
            ...option,
            closeRegistrationTime: new Date(option.closeRegistrationTime),
            description: sanitizeOptionalRichTextHtml(option.description),
            esnCardDiscountedPrice:
              option.esnCardDiscountedPrice === undefined
                ? null
                : option.esnCardDiscountedPrice,
            openRegistrationTime: new Date(option.openRegistrationTime),
            registeredDescription: sanitizeOptionalRichTextHtml(
              option.registeredDescription,
            ),
          }),
        );

        const event = yield* dbEffect((database) =>
          database.query.eventInstances.findFirst({
            where: {
              id: input.eventId,
              tenantId: tenant.id,
            },
          }),
        );
        if (!event) {
          return yield* Effect.fail('NOT_FOUND' as const);
        }
        if (
          !canEditEvent({
            creatorId: event.creatorId,
            permissions: user.permissions,
            userId: user.id,
          })
        ) {
          return yield* Effect.fail('FORBIDDEN' as const);
        }
        if (
          !EDITABLE_EVENT_STATUSES.includes(
            event.status as (typeof EDITABLE_EVENT_STATUSES)[number],
          )
        ) {
          return yield* Effect.fail('CONFLICT' as const);
        }

        const esnCardEnabledForTenant = isEsnCardEnabled(
          tenant.discountProviders ?? null,
        );

        for (const option of sanitizedRegistrationOptions) {
          if (
            Number.isNaN(option.closeRegistrationTime.getTime()) ||
            Number.isNaN(option.openRegistrationTime.getTime())
          ) {
            return yield* Effect.fail('BAD_REQUEST' as const);
          }

          const validation = yield* dbEffect((database) =>
            validateTaxRate(database, {
              isPaid: option.isPaid,
              stripeTaxRateId: option.stripeTaxRateId ?? null,
              tenantId: tenant.id,
            }),
          );
          if (!validation.success) {
            return yield* Effect.fail('BAD_REQUEST' as const);
          }

          if (
            option.esnCardDiscountedPrice !== null &&
            option.esnCardDiscountedPrice > option.price
          ) {
            return yield* Effect.fail('BAD_REQUEST' as const);
          }

          if (
            option.esnCardDiscountedPrice !== null &&
            !esnCardEnabledForTenant &&
            option.isPaid
          ) {
            return yield* Effect.fail('BAD_REQUEST' as const);
          }

          if (option.spots < 0) {
            return yield* Effect.fail('BAD_REQUEST' as const);
          }
        }

        const updatedEvent = yield* dbEffect((database) =>
          database.transaction((tx) =>
            Effect.gen(function* () {
              const updatedEvents = yield* tx
                .update(eventInstances)
                .set({
                  description: sanitizedDescription,
                  end,
                  icon: input.icon,
                  location: input.location,
                  start,
                  title: input.title,
                })
                .where(
                  and(
                    eq(eventInstances.id, input.eventId),
                    eq(eventInstances.tenantId, tenant.id),
                    inArray(eventInstances.status, [
                      ...EDITABLE_EVENT_STATUSES,
                    ]),
                  ),
                )
                .returning({
                  id: eventInstances.id,
                });
              const eventRow = updatedEvents[0];
              if (!eventRow) {
                return yield* Effect.fail('CONFLICT' as const);
              }

              const existingRegistrationRows =
                yield* tx.query.eventRegistrationOptions.findMany({
                  where: {
                    eventId: input.eventId,
                  },
                });
              const existingRegistrationOptionIds = new Set(
                existingRegistrationRows.map((option) => option.id),
              );
              for (const option of sanitizedRegistrationOptions) {
                if (!existingRegistrationOptionIds.has(option.id)) {
                  return yield* Effect.fail('BAD_REQUEST' as const);
                }
              }

              yield* Effect.forEach(sanitizedRegistrationOptions, (option) =>
                tx
                  .update(eventRegistrationOptions)
                  .set({
                    closeRegistrationTime: option.closeRegistrationTime,
                    description: option.description,
                    isPaid: option.isPaid,
                    openRegistrationTime: option.openRegistrationTime,
                    organizingRegistration: option.organizingRegistration,
                    price: option.price,
                    registeredDescription: option.registeredDescription,
                    registrationMode: option.registrationMode,
                    roleIds: [...option.roleIds],
                    spots: option.spots,
                    stripeTaxRateId: option.stripeTaxRateId ?? null,
                    title: option.title,
                  })
                  .where(
                    and(
                      eq(eventRegistrationOptions.eventId, input.eventId),
                      eq(eventRegistrationOptions.id, option.id),
                    ),
                  ),
              );

              const existingEsnDiscounts =
                sanitizedRegistrationOptions.length === 0
                  ? []
                  : yield* tx
                      .select()
                      .from(eventRegistrationOptionDiscounts)
                      .where(
                        and(
                          eq(
                            eventRegistrationOptionDiscounts.discountType,
                            'esnCard',
                          ),
                          inArray(
                            eventRegistrationOptionDiscounts.registrationOptionId,
                            sanitizedRegistrationOptions.map(
                              (registrationOption) => registrationOption.id,
                            ),
                          ),
                        ),
                      );
              const existingEsnDiscountByRegistrationOptionId = new Map(
                existingEsnDiscounts.map((discount) => [
                  discount.registrationOptionId,
                  discount,
                ]),
              );

              for (const option of sanitizedRegistrationOptions) {
                const existingDiscount =
                  existingEsnDiscountByRegistrationOptionId.get(option.id);
                const shouldPersistDiscount =
                  esnCardEnabledForTenant &&
                  option.isPaid &&
                  option.esnCardDiscountedPrice !== null;

                if (!shouldPersistDiscount) {
                  if (existingDiscount) {
                    yield* tx
                      .delete(eventRegistrationOptionDiscounts)
                      .where(
                        eq(
                          eventRegistrationOptionDiscounts.id,
                          existingDiscount.id,
                        ),
                      );
                  }
                  continue;
                }

                const discountedPrice = option.esnCardDiscountedPrice;
                if (discountedPrice === null) {
                  continue;
                }

                if (existingDiscount) {
                  yield* tx
                    .update(eventRegistrationOptionDiscounts)
                    .set({
                      discountedPrice,
                    })
                    .where(
                      eq(
                        eventRegistrationOptionDiscounts.id,
                        existingDiscount.id,
                      ),
                    );
                  continue;
                }

                yield* tx.insert(eventRegistrationOptionDiscounts).values({
                  discountedPrice,
                  discountType: 'esnCard',
                  registrationOptionId: option.id,
                });
              }

              return eventRow;
            }),
          ),
        ).pipe(
          Effect.catchAll((error) =>
            error === 'BAD_REQUEST' || error === 'CONFLICT'
              ? Effect.fail(error)
              : Effect.fail('INTERNAL_SERVER_ERROR' as const),
          ),
        );

        return {
          id: updatedEvent.id,
        };
      }),
    'events.updateListing': ({ eventId, unlisted }, options) =>
      Effect.gen(function* () {
        yield* ensurePermission(options.headers, 'events:changeListing');
        const tenant = decodeHeaderJson(
          options.headers[RPC_CONTEXT_HEADERS.TENANT],
          Tenant,
        );

        yield* dbEffect((database) =>
          database
            .update(eventInstances)
            .set({ unlisted })
            .where(
              and(
                eq(eventInstances.tenantId, tenant.id),
                eq(eventInstances.id, eventId),
              ),
            ),
        );
      }),
} satisfies Partial<AppRpcHandlers>;
