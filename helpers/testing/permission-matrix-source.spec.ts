import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { permissionMatrix } from '../../tests/support/permissions/matrix';

// Source guard: permission-denial Playwright cases should track guarded route
// manifests as routes move between admin, finance, and template feature areas.
const repositoryRoot = new URL('../..', import.meta.url).pathname;

const financePermissionMatrixCases = () =>
  permissionMatrix
    .filter((matrixCase) => matrixCase.allowedRoute.startsWith('/finance/'))
    .map((matrixCase) => ({
      capability: matrixCase.capability,
      deniedRoute: matrixCase.deniedRoute,
      permissions: matrixCase.requiredPermissions,
      route: matrixCase.allowedRoute,
    }))
    .sort((left, right) => left.route.localeCompare(right.route));

const financeChildPermissionRoutes = () => {
  const source = readFileSync(
    join(repositoryRoot, 'src/app/finance/finance.routes.ts'),
    'utf8',
  );
  const childRoutePattern =
    /permissions:\s*\[\s*'([^']+)'\s*\][\s\S]*?path:\s*'([^']+)'/g;

  return [...source.matchAll(childRoutePattern)]
    .map(([, permission, path]) => ({
      permissions: [permission],
      route: `/finance/${path.replace(':receiptId', 'route-guard-placeholder')}`,
    }))
    .sort((left, right) => left.route.localeCompare(right.route));
};

describe('permission matrix source coverage', () => {
  it('keeps finance route-denial coverage aligned with guarded child routes', () => {
    expect(financePermissionMatrixCases()).toEqual(
      financeChildPermissionRoutes().map(({ permissions, route }) => ({
        capability: expect.stringContaining('finance '),
        deniedRoute: route,
        permissions,
        route,
      })),
    );
  });

  it('keeps finance permission matrix cases on explicit child permissions', () => {
    expect(
      financePermissionMatrixCases().flatMap(
        (matrixCase) => matrixCase.permissions,
      ),
    ).toEqual([
      'finance:approveReceipts',
      'finance:approveReceipts',
      'finance:refundReceipts',
      'finance:viewTransactions',
    ]);
  });
});
