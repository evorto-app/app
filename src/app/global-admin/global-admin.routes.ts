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
        title: 'Platform audit',
      },
      {
        loadComponent: () =>
          import('./tenant-create/tenant-create.component').then(
            (m) => m.TenantCreateComponent,
          ),
        path: 'tenants/create',
        title: 'Create organization',
      },
      {
        loadComponent: () =>
          import('./tenant-edit/tenant-edit.component').then(
            (m) => m.TenantEditComponent,
          ),
        path: 'tenants/:tenantId/edit',
        title: 'Edit organization',
      },
      {
        loadComponent: () =>
          import('./platform-tenant-admin/platform-finance.component').then(
            (m) => m.PlatformFinanceComponent,
          ),
        path: 'tenants/:tenantId/payment-support',
        title: 'Payment recovery',
      },
      {
        loadComponent: () =>
          import('./tenant-detail/tenant-detail.component').then(
            (m) => m.TenantDetailComponent,
          ),
        path: 'tenants/:tenantId',
        title: 'Organization details',
      },
      {
        loadComponent: () =>
          import('./email-outbox/email-outbox.component').then(
            (m) => m.EmailOutboxComponent,
          ),
        path: 'email-outbox',
        title: 'Email delivery',
      },
      {
        loadComponent: () =>
          import('./tenant-list/tenant-list.component').then(
            (m) => m.TenantListComponent,
          ),
        path: 'tenants',
        title: 'Organizations',
      },
    ],
    loadComponent: () =>
      import('./ga-overview/ga-overview.component').then(
        (m) => m.GaOverviewComponent,
      ),
    path: '',
  },
] as const;
