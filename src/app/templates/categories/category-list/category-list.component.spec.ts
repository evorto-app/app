import { describe, expect, it } from 'vitest';

import { templateCategoryActionDisabled } from './category-list.component';

describe('templateCategoryActionDisabled', () => {
  it('blocks category actions while any category write is pending', () => {
    expect(
      templateCategoryActionDisabled({
        createPending: false,
        updatePending: false,
      }),
    ).toBe(false);
    expect(
      templateCategoryActionDisabled({
        createPending: true,
        updatePending: false,
      }),
    ).toBe(true);
    expect(
      templateCategoryActionDisabled({
        createPending: false,
        updatePending: true,
      }),
    ).toBe(true);
  });
});
