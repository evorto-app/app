import { describe, expect, it } from 'vitest';

import {
  scanCheckInActionDisabled,
  scanCheckInButtonLabel,
  scanSpotCountLabel,
} from './handle-registration.component';

describe('scanCheckInActionDisabled', () => {
  it('blocks check-in when unavailable, already completed, pending, or empty', () => {
    expect(
      scanCheckInActionDisabled({
        allowCheckin: false,
        checkInCompleted: false,
        mutationPending: false,
        spotCount: 1,
      }),
    ).toBe(true);
    expect(
      scanCheckInActionDisabled({
        allowCheckin: true,
        checkInCompleted: true,
        mutationPending: false,
        spotCount: 1,
      }),
    ).toBe(true);
    expect(
      scanCheckInActionDisabled({
        allowCheckin: true,
        checkInCompleted: false,
        mutationPending: true,
        spotCount: 1,
      }),
    ).toBe(true);
    expect(
      scanCheckInActionDisabled({
        allowCheckin: true,
        checkInCompleted: false,
        mutationPending: false,
        spotCount: 0,
      }),
    ).toBe(true);
    expect(
      scanCheckInActionDisabled({
        allowCheckin: true,
        checkInCompleted: false,
        mutationPending: false,
        spotCount: 1,
      }),
    ).toBe(false);
  });
});

describe('scan check-in copy', () => {
  it('keeps the primary check-in action readable for one or more spots', () => {
    expect(scanCheckInButtonLabel({ pending: false, spotCount: 1 })).toBe(
      'Confirm check-in',
    );
    expect(scanCheckInButtonLabel({ pending: false, spotCount: 3 })).toBe(
      'Confirm 3 check-ins',
    );
  });

  it('keeps the pending action state short and active', () => {
    expect(scanCheckInButtonLabel({ pending: true, spotCount: 3 })).toBe(
      'Checking in...',
    );
  });

  it('uses singular and plural spot suffixes for guest check-in selection', () => {
    expect(scanSpotCountLabel(1)).toBe('1 spot now');
    expect(scanSpotCountLabel(3)).toBe('3 spots now');
  });
});
