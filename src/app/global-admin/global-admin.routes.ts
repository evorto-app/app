import { Routes } from '@angular/router';

import { platformAuthorityGuard } from '../core/guards/platform-authority.guard';
import { PLATFORM_EVENT_OPERATION_ROUTES } from './platform-event-operations/platform-event-operations.routes';

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
      ...PLATFORM_EVENT_OPERATION_ROUTES,
      {
        loadComponent: () =>
          import('./platform-tenant-admin/platform-tenant-users.component').then(
            (m) => m.PlatformTenantUsersComponent,
          ),
        path: 'tenants/:tenantId/users',
      },
      {
        loadComponent: () =>
          import('./platform-tenant-admin/platform-roles.component').then(
            (m) => m.PlatformRolesComponent,
          ),
        path: 'tenants/:tenantId/roles',
      },
      {
        loadComponent: () =>
          import('./platform-tenant-admin/platform-tax-rates.component').then(
            (m) => m.PlatformTaxRatesComponent,
          ),
        path: 'tenants/:tenantId/tax-rates',
      },
      {
        loadComponent: () =>
          import('./platform-tenant-admin/platform-finance.component').then(
            (m) => m.PlatformFinanceComponent,
          ),
        path: 'tenants/:tenantId/finance',
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
