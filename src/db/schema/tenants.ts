import {
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

export const localeEnum = pgEnum('locale', ['en-AU', 'en-GB', 'en-US']);

export const timezoneEnum = pgEnum('timezone', [
  'Europe/Prague',
  'Europe/Berlin',
  'Australia/Brisbane',
]);

export const tenants = pgTable('tenants', {
  createdAt: timestamp().notNull().defaultNow(),
  currency: currencyEnum().notNull().default('EUR'),
  defaultLocation: jsonb('default_location').$type<GoogleLocationType>(),
  discountProviders: jsonb('discount_providers')
    .$type<TenantDiscountProviders>()
    .notNull()
    .default(createDefaultTenantDiscountProviders()),
  domain: text().unique().notNull(),
  id: varchar({ length: 20 })
    .$defaultFn(() => createId())
    .primaryKey(),
  locale: localeEnum().notNull().default('en-GB'),
  name: varchar().notNull(),
  receiptSettings: jsonb('receipt_settings')
    .$type<TenantReceiptSettings>()
    .notNull()
    .default({
      allowOther: DEFAULT_TENANT_RECEIPT_ALLOW_OTHER,
      receiptCountries: [...DEFAULT_TENANT_RECEIPT_COUNTRIES],
    }),
  seoDescription: text(),
  seoTitle: text(),
  stripeAccountId: varchar(),
  theme: applicationThemes().notNull().default('evorto'),
  timezone: timezoneEnum().notNull().default('Europe/Berlin'),
  updatedAt: timestamp()
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
