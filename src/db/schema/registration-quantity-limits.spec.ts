import { describe, expect, it } from '@effect/vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';

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

const checkNames = (table: Parameters<typeof getTableConfig>[0]): string[] =>
  getTableConfig(table).checks.map((check) => check.name);

describe('registration quantity database limits', () => {
  it('keeps fresh registration and add-on storage bounded', () => {
    expect(checkNames(eventRegistrations)).toEqual(
      expect.arrayContaining([
        'event_registrations_guest_count_bounded',
        'event_registrations_checked_in_guest_count_bounded',
      ]),
    );
    expect(checkNames(eventAddons)).toContain(
      'event_addons_max_quantity_per_user_bounded',
    );
    expect(checkNames(templateEventAddons)).toContain(
      'template_event_addons_max_quantity_per_user_bounded',
    );
    expect(checkNames(addonToEventRegistrationOptions)).toContain(
      'addon_to_event_registration_options_quantity_bounded',
    );
    expect(checkNames(addonToTemplateRegistrationOptions)).toContain(
      'addon_to_template_options_quantity_bounded',
    );
    expect(checkNames(eventRegistrationAddonPurchases)).toContain(
      'event_registration_addon_purchases_quantity_bounded',
    );
    expect(checkNames(eventRegistrationAddonPurchaseOrders)).toContain(
      'event_registration_addon_purchase_orders_quantity_bounded',
    );
    expect(checkNames(eventRegistrationAddonPurchaseLots)).toContain(
      'event_registration_addon_purchase_lots_quantity_bounded',
    );
  });

  it('keeps transfer and refund-allocation snapshots bounded', () => {
    expect(checkNames(registrationTransfers)).toEqual(
      expect.arrayContaining([
        'registration_transfers_source_spot_count_bounded',
        'registration_transfers_source_spot_count_positive',
      ]),
    );
    expect(checkNames(registrationTransferBundleAddonPurchases)).toEqual(
      expect.arrayContaining([
        'registration_transfer_bundle_quantity_bounded',
        'registration_transfer_bundle_refund_bounds',
      ]),
    );
    expect(checkNames(registrationTransferBundleAddonPurchaseLots)).toEqual(
      expect.arrayContaining([
        'registration_transfer_bundle_addon_lot_fulfillment_bounds',
        'registration_transfer_bundle_addon_lot_quantity_bounded',
      ]),
    );
    expect(checkNames(registrationAcquisitions)).toEqual(
      expect.arrayContaining([
        'registration_acquisition_spot_count_bounded',
        'registration_acquisition_spot_count_positive',
      ]),
    );
    expect(checkNames(registrationAcquisitionComponents)).toContain(
      'registration_acquisition_component_quantity_bounded',
    );
  });
});
