import { Routes } from '@angular/router';

export const FINANCE_ROUTES: Routes = [
  {
    children: [
      {
        loadComponent: () =>
          import('./transaction-list/transaction-list.component').then(
            (m) => m.TransactionListComponent,
          ),
        path: 'transactions',
      },
      {
        loadComponent: () =>
          import(
            './receipt-approval-list/receipt-approval-list.component'
          ).then((m) => m.ReceiptApprovalListComponent),
        path: 'receipts-approval',
      },
      {
        loadComponent: () =>
          import(
            './receipt-approval-detail/receipt-approval-detail.component'
          ).then((m) => m.ReceiptApprovalDetailComponent),
        path: 'receipts-approval/:receiptId',
      },
      {
        loadComponent: () =>
          import('./receipt-refund-list/receipt-refund-list.component').then(
            (m) => m.ReceiptRefundListComponent,
          ),
        path: 'receipts-refunds',
      },
    ],
    loadComponent: () =>
      import('./finance-overview/finance-overview.component').then(
        (m) => m.FinanceOverviewComponent,
      ),
    path: '',
  },
];
