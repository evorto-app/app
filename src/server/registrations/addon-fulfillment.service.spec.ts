import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { selectRegistrationAddonCancellation } from './addon-fulfillment.service';

describe('selectRegistrationAddonCancellation', () => {
  const lots = [
    {
      cancelledQuantity: 0,
      id: 'lot-a',
      quantity: 2,
      redeemedQuantity: 1,
    },
    {
      cancelledQuantity: 1,
      id: 'lot-b',
      quantity: 2,
      redeemedQuantity: 0,
    },
  ] as const;

  it('cancels unredeemed purchased lots before included quantities', () => {
    expect(
      selectRegistrationAddonCancellation({
        cancelledQuantity: 1,
        includedQuantity: 2,
        lots,
        quantity: 3,
        redeemedQuantity: 2,
      }),
    ).toEqual({
      includedQuantity: 1,
      lots: [
        { id: 'lot-a', quantity: 1 },
        { id: 'lot-b', quantity: 1 },
      ],
    });
  });

  it('never reallocates redeemed or already-cancelled quantities', () => {
    expect(
      selectRegistrationAddonCancellation({
        cancelledQuantity: 1,
        includedQuantity: 2,
        lots,
        quantity: 2,
        redeemedQuantity: 2,
      }),
    ).toEqual({
      includedQuantity: 0,
      lots: [
        { id: 'lot-a', quantity: 1 },
        { id: 'lot-b', quantity: 1 },
      ],
    });
  });

  it('rejects quantities beyond the exact unfulfilled remainder', () => {
    expect(
      selectRegistrationAddonCancellation({
        cancelledQuantity: 1,
        includedQuantity: 2,
        lots,
        quantity: 4,
        redeemedQuantity: 2,
      }),
    ).toBeUndefined();
  });

  it('rejects inconsistent included-versus-lot counters', () => {
    expect(
      selectRegistrationAddonCancellation({
        cancelledQuantity: 0,
        includedQuantity: 2,
        lots,
        quantity: 1,
        redeemedQuantity: 0,
      }),
    ).toBeUndefined();
  });
});

describe('fulfillment concurrency source guards', () => {
  const source = readFileSync(
    new URL('addon-fulfillment.service.ts', import.meta.url),
    'utf8',
  );

  it('reads fulfillment state from one repeatable-read snapshot', () => {
    expect(source).toContain("accessMode: 'read only'");
    expect(source).toContain("isolationLevel: 'repeatable read'");
  });

  it('selects the latest active redemption rather than a reversed event', () => {
    expect(source).toContain("'active_redemption_reversal'");
    expect(source).toContain('notExists(');
    expect(source).toContain('reversal.reversesEventId');
  });

  it('guards active transfers after taking the registration lock', () => {
    const lockHelper = source.slice(
      source.indexOf("Effect.fn('lockFulfillmentRows')"),
      source.indexOf('export const cancelRemainingRegistrationAddons'),
    );
    expect(lockHelper.indexOf('.from(eventRegistrations)')).toBeGreaterThan(-1);
    expect(
      lockHelper.indexOf('ensureRegistrationMutationHasNoActiveTransfer'),
    ).toBeGreaterThan(lockHelper.indexOf('.from(eventRegistrations)'));
    expect(
      lockHelper.indexOf('.from(eventRegistrationAddonPurchases)'),
    ).toBeGreaterThan(
      lockHelper.indexOf('ensureRegistrationMutationHasNoActiveTransfer'),
    );
  });
});
