import { Routes } from '@angular/router';

export const GLOBAL_ADMIN_ROUTES: Routes = [
  {
    children: [
      {
        loadComponent: () =>
          import('./tenant-list/tenant-list.component').then((m) => m.TenantListComponent),
        path: 'tenants',
      },
    ],
    loadComponent: () =>
      import('./ga-overview/ga-overview.component').then((m) => m.GaOverviewComponent),
    path: '',
  },
] as const;
