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
      'You can no longer manage template categories. No change was saved. Ask an administrator if you need this access.',
    );
  });

  it('uses focused fallback copy for other mutation failures', () => {
    expect(
      templateCategoryMutationErrorMessage({
        message: 'Category not found',
      }),
    ).toBe("We couldn't save this template category. Try again.");
  });

  it('shows a missing category without exposing internal failures', () => {
    expect(
      templateCategoryMutationErrorMessage({
        _tag: 'TemplateCategoryNotFoundError',
        message: 'This template category could not be found.',
      }),
    ).toBe('This template category could not be found.');
    expect(
      templateCategoryMutationErrorMessage({
        _tag: 'RpcInternalServerError',
        message: 'database failed',
      }),
    ).toBe("We couldn't save this template category. Try again.");
  });
});
