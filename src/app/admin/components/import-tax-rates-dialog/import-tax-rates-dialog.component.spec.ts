import { describe, expect, it } from 'vitest';

import { taxRateImportActionDisabled } from './import-tax-rates-dialog.component';

describe('taxRateImportActionDisabled', () => {
  it('disables import when no tax rates are selected', () => {
    expect(
      taxRateImportActionDisabled({
        mutationPending: false,
        selectedCount: 0,
      }),
    ).toBe(true);
  });

  it('disables import while an import is already pending', () => {
    expect(
      taxRateImportActionDisabled({
        mutationPending: true,
        selectedCount: 1,
      }),
    ).toBe(true);
  });

  it('allows import only when selected tax rates are idle', () => {
    expect(
      taxRateImportActionDisabled({
        mutationPending: false,
        selectedCount: 1,
      }),
    ).toBe(false);
  });
});
