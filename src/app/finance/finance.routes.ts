import { Routes } from '@angular/router';

import { permissionGuard } from '../core/guards/permission.guard';

export const FINANCE_ROUTES: Routes = [
  {
    canActivate: [permissionGuard],
    children: [
      {
        canActivate: [permissionGuard],
        data: {
          permissions: ['finance:viewTransactions'],
        },
        loadComponent: () =>
          import('./transaction-list/transaction-list.component').then(
            (m) => m.TransactionListComponent,
          ),
        path: 'transactions',
        title: 'Transactions',
      },
      {
        canActivate: [permissionGuard],
        data: {
          permissions: ['finance:approveReceipts'],
        },
        loadComponent: () =>
          import('./receipt-approval-list/receipt-approval-list.component').then(
            (m) => m.ReceiptApprovalListComponent,
          ),
        path: 'receipts-approval',
        title: 'Receipt approvals',
      },
      {
        canActivate: [permissionGuard],
        data: {
          permissions: ['finance:approveReceipts'],
        },
        loadComponent: () =>
          import('./receipt-approval-detail/receipt-approval-detail.component').then(
            (m) => m.ReceiptApprovalDetailComponent,
          ),
        path: 'receipts-approval/:receiptId',
        title: 'Review receipt',
      },
      {
        canActivate: [permissionGuard],
        data: {
          permissions: ['finance:refundReceipts'],
        },
        loadComponent: () =>
          import('./receipt-refund-list/receipt-refund-list.component').then(
            (m) => m.ReceiptRefundListComponent,
          ),
        path: 'receipts-refunds',
        title: 'Receipt reimbursements',
      },
    ],
    data: {
      anyPermissions: [
        'finance:viewTransactions',
        'finance:approveReceipts',
        'finance:refundReceipts',
        'finance:*',
      ],
    },
    loadComponent: () =>
      import('./finance-overview/finance-overview.component').then(
        (m) => m.FinanceOverviewComponent,
      ),
    path: '',
  },
];
