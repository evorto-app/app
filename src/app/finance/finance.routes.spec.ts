import { describe, expect, it } from 'vitest';

import { permissionGuard } from '../core/guards/permission.guard';
import { FINANCE_ROUTES } from './finance.routes';

describe('FINANCE_ROUTES', () => {
  const shellRoute = FINANCE_ROUTES.find((route) => route.path === '');

  it('requires at least one finance permission at the route shell', () => {
    expect(shellRoute?.canActivate).toContain(permissionGuard);
    expect(shellRoute?.data).toEqual({
      anyPermissions: [
        'finance:viewTransactions',
        'finance:approveReceipts',
        'finance:refundReceipts',
        'finance:*',
      ],
    });
  });

  it.each([
    {
      path: 'transactions',
      permissions: ['finance:viewTransactions'],
    },
    {
      path: 'receipts-approval',
      permissions: ['finance:approveReceipts'],
    },
    {
      path: 'receipts-approval/:receiptId',
      permissions: ['finance:approveReceipts'],
    },
    {
      path: 'receipts-refunds',
      permissions: ['finance:refundReceipts'],
    },
  ])(
    'guards $path with its child finance permission',
    ({ path, permissions }) => {
      const childRoute = shellRoute?.children?.find(
        (route) => route.path === path,
      );

      expect(childRoute?.canActivate).toContain(permissionGuard);
      expect(childRoute?.data).toEqual({ permissions });
    },
  );
});
