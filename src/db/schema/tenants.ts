import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

import {
  createDefaultTenantDiscountProviders,
  DEFAULT_TENANT_RECEIPT_ALLOW_OTHER,
  DEFAULT_TENANT_RECEIPT_COUNTRIES,
  type TenantDiscountProviders,
  type TenantReceiptSettings,
} from '../../shared/tenant-config';
import { GoogleLocationType } from '../../types/location';
import { createId } from '../create-id';

export const applicationThemes = pgEnum('application_theme', ['evorto', 'esn']);

export const currencyEnum = pgEnum('currency', ['EUR', 'CZK', 'AUD']);

export const localeEnum = pgEnum('locale', [
  'de-DE',
  'en-AU',
  'en-GB',
  'en-US',
]);

export const tenants = pgTable(
  'tenants',
  {
    cancellationDeadlineHoursBeforeStart: integer(
      'cancellation_deadline_hours_before_start',
    )
      .notNull()
      .default(120),
    canonicalRootUrl: text('canonical_root_url').notNull(),
    createdAt: timestamp().notNull().defaultNow(),
    currency: currencyEnum().notNull().default('EUR'),
    defaultLocation: jsonb('default_location').$type<GoogleLocationType>(),
    discountProviders: jsonb('discount_providers')
      .$type<TenantDiscountProviders>()
      .notNull()
      .default(createDefaultTenantDiscountProviders()),
    domain: text().unique().notNull(),
    emailSenderEmail: text('email_sender_email'),
    emailSenderName: text('email_sender_name'),
    faviconUrl: text('favicon_url'),
    id: varchar({ length: 20 })
      .$defaultFn(() => createId())
      .primaryKey(),
    legalNoticeText: text('legal_notice_text'),
    legalNoticeUrl: text('legal_notice_url'),
    locale: localeEnum().notNull().default('de-DE'),
    logoUrl: text('logo_url'),
    maxActiveRegistrationsPerUser: integer('max_active_registrations_per_user')
      .notNull()
      .default(0),
    name: varchar().notNull(),
    privacyPolicyText: text('privacy_policy_text'),
    privacyPolicyUrl: text('privacy_policy_url'),
    receiptSettings: jsonb('receipt_settings')
      .$type<TenantReceiptSettings>()
      .notNull()
      .default({
        allowOther: DEFAULT_TENANT_RECEIPT_ALLOW_OTHER,
        receiptCountries: [...DEFAULT_TENANT_RECEIPT_COUNTRIES],
      }),
    refundFeesOnCancellation: boolean('refund_fees_on_cancellation')
      .notNull()
      .default(true),
    seoDescription: text(),
    seoTitle: text(),
    stripeAccountId: varchar(),
    termsText: text('terms_text'),
    termsUrl: text('terms_url'),
    theme: applicationThemes().notNull().default('evorto'),
    timezone: varchar({ length: 64 }).notNull().default('Europe/Berlin'),
    transferDeadlineHoursBeforeStart: integer(
      'transfer_deadline_hours_before_start',
    )
      .notNull()
      .default(0),
    updatedAt: timestamp()
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    check(
      'tenants_cancellation_deadline_hours_nonnegative',
      sql`${table.cancellationDeadlineHoursBeforeStart} >= 0`,
    ),
    check(
      'tenants_canonical_root_url_matches_domain',
      sql`${table.canonicalRootUrl} = 'https://' || ${table.domain} OR (${table.domain} IN ('localhost', '127.0.0.1', '[::1]') AND ${table.canonicalRootUrl} = 'http://' || ${table.domain})`,
    ),
    check(
      'tenants_transfer_deadline_hours_nonnegative',
      sql`${table.transferDeadlineHoursBeforeStart} >= 0`,
    ),
  ],
);
