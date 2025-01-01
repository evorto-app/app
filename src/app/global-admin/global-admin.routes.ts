import { Routes } from '@angular/router';

export const GLOBAL_ADMIN_ROUTES: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'tenants' },
  {
    loadComponent: () =>
      import('./tenant-list/tenant-list.component').then(
        (m) => m.TenantListComponent,
      ),
    path: 'tenants',
  },
] as const;
