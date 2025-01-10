import { Routes } from '@angular/router';

export const GLOBAL_ADMIN_ROUTES: Routes = [
  {
    loadComponent: () =>
      import('./ga-overview/ga-overview.component').then(
        (m) => m.GaOverviewComponent,
      ),
    path: '',
    pathMatch: 'full',
  },
  {
    loadComponent: () =>
      import('./tenant-list/tenant-list.component').then(
        (m) => m.TenantListComponent,
      ),
    path: 'tenants',
  },
] as const;
