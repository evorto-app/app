import { createHash } from 'node:crypto';

export interface OrganizerDirectTransferLockedStateVersion {
  readonly acquisition: string;
  readonly acquisitionComponents: readonly string[];
  readonly acquisitionPayments: readonly string[];
  readonly addOnLots: readonly string[];
  readonly discountCards: readonly string[];
  readonly discounts: readonly string[];
  readonly pricing: string;
  readonly sourceRefunds: readonly string[];
  readonly sourceTransactions: readonly string[];
  readonly targetRoleIds: readonly string[];
  readonly taxRates: readonly string[];
}

export interface OrganizerDirectTransferPreviewAddonVersion {
  readonly addonId: string;
  readonly cancelledQuantity: number;
  readonly currentUnitPrice: number;
  readonly description: null | string;
  readonly includedQuantity: number;
  readonly purchasedQuantity: number;
  readonly purchaseId: string;
  readonly quantity: number;
  readonly redeemedQuantity: number;
  readonly title: string;
}

export interface OrganizerDirectTransferPreviewVersion {
  readonly acquisitionId: string;
  readonly addOns: readonly OrganizerDirectTransferPreviewAddonVersion[];
  readonly checkedInGuestCount: number;
  readonly checkInTime: Date | null;
  readonly guestCount: number;
  readonly guestUnitPrice: number;
  readonly lockedState: OrganizerDirectTransferLockedStateVersion;
  readonly registrationId: string;
  readonly registrationOptionId: string;
  readonly registrationOptionTitle: string;
  readonly sourceUserId: string;
  readonly targetUserId: string;
}

const sorted = (values: readonly string[]): readonly string[] =>
  values.toSorted((left, right) => left.localeCompare(right));

export const organizerDirectTransferPreviewVersion = (
  version: OrganizerDirectTransferPreviewVersion,
): string =>
  createHash('sha256')
    .update(
      JSON.stringify([
        'organizer-direct-transfer-preview:v1',
        {
          ...version,
          addOns: version.addOns.toSorted((left, right) =>
            left.purchaseId.localeCompare(right.purchaseId),
          ),
          checkInTime: version.checkInTime?.toISOString() ?? null,
          lockedState: {
            ...version.lockedState,
            acquisitionComponents: sorted(
              version.lockedState.acquisitionComponents,
            ),
            acquisitionPayments: sorted(
              version.lockedState.acquisitionPayments,
            ),
            addOnLots: sorted(version.lockedState.addOnLots),
            discountCards: sorted(version.lockedState.discountCards),
            discounts: sorted(version.lockedState.discounts),
            sourceRefunds: sorted(version.lockedState.sourceRefunds),
            sourceTransactions: sorted(version.lockedState.sourceTransactions),
            targetRoleIds: sorted(version.lockedState.targetRoleIds),
            taxRates: sorted(version.lockedState.taxRates),
          },
        },
      ]),
      'utf8',
    )
    .digest('base64url');
