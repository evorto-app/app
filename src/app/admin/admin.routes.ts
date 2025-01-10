import { Routes } from '@angular/router';

export const ADMIN_ROUTES: Routes = [
  {
    children: [
      {
        loadComponent: () =>
          import('./role-list/role-list.component').then(
            (m) => m.RoleListComponent,
          ),
        path: 'roles',
      },
    ],
    loadComponent: () =>
      import('./admin-overview/admin-overview.component').then(
        (m) => m.AdminOverviewComponent,
      ),
    path: '',
  },
];
