import { Routes } from '@angular/router';

import { permissionGuard } from '../core/guards/permission.guard';

export const GLOBAL_ADMIN_ROUTES: Routes = [
  {
    canActivate: [permissionGuard],
    children: [
      {
        loadComponent: () =>
          import('./tenant-list/tenant-list.component').then(
            (m) => m.TenantListComponent,
          ),
        path: 'tenants',
      },
    ],
    data: {
      permissions: ['globalAdmin:manageTenants'],
    },
    loadComponent: () =>
      import('./ga-overview/ga-overview.component').then(
        (m) => m.GaOverviewComponent,
      ),
    path: '',
  },
] as const;
