import { describe, expect, it } from 'vitest';

import {
  templateCategoryActionDisabled,
  templateCategoryColumns,
  templateCategoryMutationErrorMessage,
} from './category-list.component';

describe('templateCategoryActionDisabled', () => {
  it('blocks category actions while any category write is pending', () => {
    expect(
      templateCategoryActionDisabled({
        canManageCategories: true,
        createPending: false,
        updatePending: false,
      }),
    ).toBe(false);
    expect(
      templateCategoryActionDisabled({
        canManageCategories: true,
        createPending: true,
        updatePending: false,
      }),
    ).toBe(true);
    expect(
      templateCategoryActionDisabled({
        canManageCategories: true,
        createPending: false,
        updatePending: true,
      }),
    ).toBe(true);
  });

  it('blocks category actions when the capability is absent', () => {
    expect(
      templateCategoryActionDisabled({
        canManageCategories: false,
        createPending: false,
        updatePending: false,
      }),
    ).toBe(true);
  });
});

describe('template category permission presentation', () => {
  it('omits the action column for read-only users', () => {
    expect(templateCategoryColumns(false)).toEqual(['category', 'templates']);
    expect(templateCategoryColumns(true)).toEqual([
      'category',
      'templates',
      'actions',
    ]);
  });

  it('explains a server-side permission denial with a recovery step', () => {
    expect(
      templateCategoryMutationErrorMessage({
        _tag: 'RpcForbiddenError',
        message: 'Forbidden',
        permission: 'templates:manageCategories',
      }),
    ).toBe(
      'You no longer have permission to manage template categories. Reload the page to refresh your access, or ask an administrator for this permission.',
    );
  });

  it('preserves actionable non-permission mutation messages', () => {
    expect(
      templateCategoryMutationErrorMessage({
        message: 'Category not found',
      }),
    ).toBe('Category not found');
  });
});
