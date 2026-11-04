import { Routes } from '@angular/router';

import { platformAuthorityGuard } from '../core/guards/platform-authority.guard';

export const GLOBAL_ADMIN_ROUTES: Routes = [
  {
    canActivate: [platformAuthorityGuard],
    children: [
      {
        loadComponent: () =>
          import('./platform-audit/platform-audit.component').then(
            (m) => m.PlatformAuditComponent,
          ),
        path: 'audit',
      },
      {
        loadComponent: () =>
          import('./tenant-create/tenant-create.component').then(
            (m) => m.TenantCreateComponent,
          ),
        path: 'tenants/create',
      },
      {
        loadComponent: () =>
          import('./tenant-edit/tenant-edit.component').then(
            (m) => m.TenantEditComponent,
          ),
        path: 'tenants/:tenantId/edit',
      },
      {
        loadComponent: () =>
          import('./platform-tenant-admin/platform-finance.component').then(
            (m) => m.PlatformFinanceComponent,
          ),
        path: 'tenants/:tenantId/payment-support',
      },
      {
        loadComponent: () =>
          import('./tenant-detail/tenant-detail.component').then(
            (m) => m.TenantDetailComponent,
          ),
        path: 'tenants/:tenantId',
      },
      {
        loadComponent: () =>
          import('./email-outbox/email-outbox.component').then(
            (m) => m.EmailOutboxComponent,
          ),
        path: 'email-outbox',
      },
      {
        loadComponent: () =>
          import('./tenant-list/tenant-list.component').then(
            (m) => m.TenantListComponent,
          ),
        path: 'tenants',
      },
    ],
    loadComponent: () =>
      import('./ga-overview/ga-overview.component').then(
        (m) => m.GaOverviewComponent,
      ),
    path: '',
  },
] as const;
