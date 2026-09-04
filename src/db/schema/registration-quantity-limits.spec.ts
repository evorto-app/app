import { describe, expect, it } from '@effect/vitest';
import {
  MAX_REGISTRATION_ADDON_QUANTITY,
  MAX_REGISTRATION_GUESTS,
} from '@shared/registration-quantity-limits';
import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core';

import {
  addonToEventRegistrationOptions,
  addonToTemplateRegistrationOptions,
  eventAddons,
  eventRegistrationAddonPurchaseLots,
  eventRegistrationAddonPurchaseOrders,
  eventRegistrationAddonPurchases,
  eventRegistrations,
  registrationAcquisitionComponents,
  registrationAcquisitions,
  registrationTransferBundleAddonPurchaseLots,
  registrationTransferBundleAddonPurchases,
  registrationTransfers,
  templateEventAddons,
} from './index';

const quantityChecks = [
  {
    name: 'event_registrations_guest_count_bounded',
    parameters: [MAX_REGISTRATION_GUESTS],
    sql: '"event_registrations"."guest_count" BETWEEN 0 AND $1',
    table: eventRegistrations,
  },
  {
    name: 'event_registrations_checked_in_guest_count_bounded',
    parameters: [],
    sql: '"event_registrations"."checked_in_guest_count" BETWEEN 0 AND "event_registrations"."guest_count"',
    table: eventRegistrations,
  },
  {
    name: 'event_addons_max_quantity_per_user_bounded',
    parameters: [MAX_REGISTRATION_ADDON_QUANTITY],
    sql: '"event_addons"."maxQuantityPerUser" <= $1',
    table: eventAddons,
  },
  {
    name: 'template_event_addons_max_quantity_per_user_bounded',
    parameters: [MAX_REGISTRATION_ADDON_QUANTITY],
    sql: '"template_event_addons"."maxQuantityPerUser" <= $1',
    table: templateEventAddons,
  },
  {
    name: 'addon_to_event_registration_options_quantity_bounded',
    parameters: [MAX_REGISTRATION_ADDON_QUANTITY],
    sql: '"addon_to_event_registration_options"."included_quantity" + "addon_to_event_registration_options"."optional_purchase_quantity" <= $1',
    table: addonToEventRegistrationOptions,
  },
  {
    name: 'addon_to_template_options_quantity_bounded',
    parameters: [MAX_REGISTRATION_ADDON_QUANTITY],
    sql: '"addon_to_template_registration_options"."included_quantity" + "addon_to_template_registration_options"."optional_purchase_quantity" <= $1',
    table: addonToTemplateRegistrationOptions,
  },
  {
    name: 'event_registration_addon_purchases_quantity_bounded',
    parameters: [MAX_REGISTRATION_ADDON_QUANTITY],
    sql: '"event_registration_addon_purchases"."quantity" <= $1',
    table: eventRegistrationAddonPurchases,
  },
  {
    name: 'event_registration_addon_purchase_orders_quantity_bounded',
    parameters: [MAX_REGISTRATION_ADDON_QUANTITY],
    sql: '"event_registration_addon_purchase_orders"."quantity" <= $1',
    table: eventRegistrationAddonPurchaseOrders,
  },
  {
    name: 'event_registration_addon_purchase_lots_quantity_bounded',
    parameters: [MAX_REGISTRATION_ADDON_QUANTITY],
    sql: '"event_registration_addon_purchase_lots"."quantity" <= $1',
    table: eventRegistrationAddonPurchaseLots,
  },
  {
    name: 'registration_acquisition_spot_count_bounded',
    parameters: [MAX_REGISTRATION_GUESTS + 1],
    sql: '"registration_acquisitions"."spot_count" <= $1',
    table: registrationAcquisitions,
  },
  {
    name: 'registration_acquisition_component_quantity_bounded',
    parameters: [MAX_REGISTRATION_GUESTS + 1, MAX_REGISTRATION_ADDON_QUANTITY],
    sql: '("registration_acquisition_components"."kind" = \'registration\' AND "registration_acquisition_components"."quantity" <= $1) OR ("registration_acquisition_components"."kind" = \'addon_lot\' AND "registration_acquisition_components"."quantity" <= $2)',
    table: registrationAcquisitionComponents,
  },
  {
    name: 'registration_transfers_source_spot_count_bounded',
    parameters: [MAX_REGISTRATION_GUESTS + 1],
    sql: '"registration_transfers"."source_spot_count" <= $1',
    table: registrationTransfers,
  },
  {
    name: 'registration_transfer_bundle_quantity_bounded',
    parameters: [MAX_REGISTRATION_ADDON_QUANTITY],
    sql: '"registration_transfer_bundle_addon_purchases"."quantity" <= $1',
    table: registrationTransferBundleAddonPurchases,
  },
  {
    name: 'registration_transfer_bundle_addon_lot_quantity_bounded',
    parameters: [MAX_REGISTRATION_ADDON_QUANTITY],
    sql: '"registration_transfer_bundle_addon_purchase_lots"."quantity" <= $1',
    table: registrationTransferBundleAddonPurchaseLots,
  },
];

describe('registration quantity database limits', () => {
  it.each(quantityChecks)('$name bounds its intended fields', (expected) => {
    const check = getTableConfig(expected.table).checks.find(
      (candidate) => candidate.name === expected.name,
    );
    expect(check).toBeDefined();
    if (!check) throw new Error(`Missing check ${expected.name}`);

    const query = new PgDialect().sqlToQuery(check.value);
    expect(query.sql).toBe(expected.sql);
    expect(query.params).toEqual(expected.parameters);
  });
});
