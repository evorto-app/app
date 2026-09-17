import { describe, expect, it } from 'vitest';

import {
  addonPurchaseCheckoutMetadataOwnsIdentity,
  buildAddonPurchaseCheckoutMetadata,
  buildDirectRegistrationCheckoutMetadata,
  directRegistrationCheckoutMetadataOwnsIdentity,
} from './registration-checkout-metadata';

const registrationIdentity = {
  registrationId: 'registration-1',
  tenantId: 'tenant-1',
  transactionId: 'transaction-1',
  userId: 'user-1',
};

const addonIdentity = {
  addonPurchaseOrderId: 'order-1',
  ...registrationIdentity,
};

describe('registration checkout metadata', () => {
  const exactMetadata =
    buildDirectRegistrationCheckoutMetadata(registrationIdentity);

  it('builds the exact four ownership details used by direct and manually approved registrations', () => {
    expect(exactMetadata).toStrictEqual({
      registrationId: 'registration-1',
      tenantId: 'tenant-1',
      transactionId: 'transaction-1',
      userId: 'user-1',
    });
    expect(
      directRegistrationCheckoutMetadataOwnsIdentity({
        identity: registrationIdentity,
        metadata: exactMetadata,
      }),
    ).toBe(true);
  });

  it.each([
    ['null details', null],
    ['missing details', {}],
    [
      'missing user',
      {
        registrationId: 'registration-1',
        tenantId: 'tenant-1',
        transactionId: 'transaction-1',
      },
    ],
    [
      'target-user alias',
      {
        registrationId: 'registration-1',
        targetUserId: 'user-1',
        tenantId: 'tenant-1',
        transactionId: 'transaction-1',
      },
    ],
    [
      'owner-user alias',
      {
        ownerUserId: 'user-1',
        registrationId: 'registration-1',
        tenantId: 'tenant-1',
        transactionId: 'transaction-1',
      },
    ],
    ['extra target-user alias', { ...exactMetadata, targetUserId: 'user-1' }],
    ['extra owner-user alias', { ...exactMetadata, ownerUserId: 'user-1' }],
    ['extra details', { ...exactMetadata, unexpected: 'value' }],
    ['different registration', { ...exactMetadata, registrationId: 'other' }],
    ['different tenant', { ...exactMetadata, tenantId: 'other' }],
    ['different transaction', { ...exactMetadata, transactionId: 'other' }],
    ['different user', { ...exactMetadata, userId: 'other' }],
  ])('rejects %s', (_name, metadata) => {
    expect(
      directRegistrationCheckoutMetadataOwnsIdentity({
        identity: registrationIdentity,
        metadata,
      }),
    ).toBe(false);
  });
});

describe('add-on purchase checkout metadata', () => {
  const exactMetadata = buildAddonPurchaseCheckoutMetadata(addonIdentity);

  it('builds the exact five ownership details used by an add-on purchase', () => {
    expect(exactMetadata).toStrictEqual({
      addonPurchaseOrderId: 'order-1',
      registrationId: 'registration-1',
      tenantId: 'tenant-1',
      transactionId: 'transaction-1',
      userId: 'user-1',
    });
    expect(
      addonPurchaseCheckoutMetadataOwnsIdentity({
        identity: addonIdentity,
        metadata: exactMetadata,
      }),
    ).toBe(true);
  });

  it.each([
    ['null details', null],
    ['missing details', {}],
    [
      'missing order',
      {
        registrationId: 'registration-1',
        tenantId: 'tenant-1',
        transactionId: 'transaction-1',
        userId: 'user-1',
      },
    ],
    [
      'target-user alias',
      {
        addonPurchaseOrderId: 'order-1',
        registrationId: 'registration-1',
        targetUserId: 'user-1',
        tenantId: 'tenant-1',
        transactionId: 'transaction-1',
      },
    ],
    [
      'owner-user alias',
      {
        addonPurchaseOrderId: 'order-1',
        ownerUserId: 'user-1',
        registrationId: 'registration-1',
        tenantId: 'tenant-1',
        transactionId: 'transaction-1',
      },
    ],
    ['extra target-user alias', { ...exactMetadata, targetUserId: 'user-1' }],
    ['extra owner-user alias', { ...exactMetadata, ownerUserId: 'user-1' }],
    ['extra details', { ...exactMetadata, unexpected: 'value' }],
    ['different order', { ...exactMetadata, addonPurchaseOrderId: 'other' }],
    ['different registration', { ...exactMetadata, registrationId: 'other' }],
    ['different tenant', { ...exactMetadata, tenantId: 'other' }],
    ['different transaction', { ...exactMetadata, transactionId: 'other' }],
    ['different user', { ...exactMetadata, userId: 'other' }],
  ])('rejects %s', (_name, metadata) => {
    expect(
      addonPurchaseCheckoutMetadataOwnsIdentity({
        identity: addonIdentity,
        metadata,
      }),
    ).toBe(false);
  });
});
