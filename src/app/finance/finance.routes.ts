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
    ],
    loadComponent: () =>
      import('./finance-overview/finance-overview.component').then(
        (m) => m.FinanceOverviewComponent,
      ),
    path: '',
  },
];
