export interface AddonPurchaseCheckoutMetadataIdentity extends DirectRegistrationCheckoutMetadataIdentity {
  readonly addonPurchaseOrderId: string;
}

export interface DirectRegistrationCheckoutMetadataIdentity {
  readonly registrationId: string;
  readonly tenantId: string;
  readonly transactionId: string;
  readonly userId: string;
}

type CheckoutMetadata = null | Readonly<Record<string, string | undefined>>;

const registrationCheckoutMetadataKeys = [
  'registrationId',
  'tenantId',
  'transactionId',
  'userId',
] as const;

const addonPurchaseCheckoutMetadataKeys = [
  'addonPurchaseOrderId',
  ...registrationCheckoutMetadataKeys,
] as const;

const hasExactMetadataKeys = (
  metadata: CheckoutMetadata,
  expectedKeys: readonly string[],
): metadata is Readonly<Record<string, string | undefined>> =>
  metadata !== null &&
  Object.keys(metadata).length === expectedKeys.length &&
  expectedKeys.every((key) => Object.hasOwn(metadata, key));

/** Used by self-service and manually approved registrations, never transfers. */
export const buildDirectRegistrationCheckoutMetadata = (
  identity: DirectRegistrationCheckoutMetadataIdentity,
) => ({
  registrationId: identity.registrationId,
  tenantId: identity.tenantId,
  transactionId: identity.transactionId,
  userId: identity.userId,
});

export const directRegistrationCheckoutMetadataOwnsIdentity = (input: {
  readonly identity: DirectRegistrationCheckoutMetadataIdentity;
  readonly metadata: CheckoutMetadata;
}): boolean =>
  hasExactMetadataKeys(input.metadata, registrationCheckoutMetadataKeys) &&
  input.metadata['registrationId'] === input.identity.registrationId &&
  input.metadata['tenantId'] === input.identity.tenantId &&
  input.metadata['transactionId'] === input.identity.transactionId &&
  input.metadata['userId'] === input.identity.userId;

export const buildAddonPurchaseCheckoutMetadata = (
  identity: AddonPurchaseCheckoutMetadataIdentity,
) => ({
  addonPurchaseOrderId: identity.addonPurchaseOrderId,
  registrationId: identity.registrationId,
  tenantId: identity.tenantId,
  transactionId: identity.transactionId,
  userId: identity.userId,
});

export const addonPurchaseCheckoutMetadataOwnsIdentity = (input: {
  readonly identity: AddonPurchaseCheckoutMetadataIdentity;
  readonly metadata: CheckoutMetadata;
}): boolean =>
  hasExactMetadataKeys(input.metadata, addonPurchaseCheckoutMetadataKeys) &&
  input.metadata['addonPurchaseOrderId'] ===
    input.identity.addonPurchaseOrderId &&
  input.metadata['registrationId'] === input.identity.registrationId &&
  input.metadata['tenantId'] === input.identity.tenantId &&
  input.metadata['transactionId'] === input.identity.transactionId &&
  input.metadata['userId'] === input.identity.userId;
