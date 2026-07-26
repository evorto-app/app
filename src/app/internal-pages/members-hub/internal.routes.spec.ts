import { describe, expect, it } from 'vitest';

import { permissionGuard } from '../../core/guards/permission.guard';
import { INTERNAL_ROUTES } from './internal.routes';

describe('internal routes', () => {
  it('requires the internal-pages capability before loading the members hub', () => {
    const membersHubRoute = INTERNAL_ROUTES.find(
      (route) => route.path === 'members-hub',
    );

    expect(membersHubRoute?.canActivate).toEqual([permissionGuard]);
    expect(membersHubRoute?.data).toEqual({
      permissions: ['internal:viewInternalPages'],
    });
  });
});
