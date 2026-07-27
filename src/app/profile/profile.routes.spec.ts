import { describe, expect, it } from 'vitest';

import { PROFILE_ROUTES } from './profile.routes';

describe('PROFILE_ROUTES', () => {
  const shellRoute = PROFILE_ROUTES.find((route) => route.path === '');

  it('keeps one profile shell with routed concern-owned pages', () => {
    expect(shellRoute?.loadComponent).toBeTypeOf('function');
    expect(shellRoute?.children?.map((route) => route.path)).toEqual([
      '',
      'events',
      'discounts',
      'receipts',
    ]);
    expect(shellRoute?.children?.[0]?.pathMatch).toBe('full');
  });

  it('does not retain fragment redirects or compatibility routes', () => {
    expect(
      shellRoute?.children?.some((route) => route.redirectTo !== undefined),
    ).toBe(false);
  });
});
