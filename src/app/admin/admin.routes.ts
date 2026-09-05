import { Routes } from '@angular/router';

import { permissionGuard } from '../core/guards/permission.guard';
import { tenantSettingsUnsavedChangesGuard } from './settings/settings-form';

export const ADMIN_ROUTES: Routes = [
  {
    canActivate: [permissionGuard],
    children: [
      {
        canActivate: [permissionGuard],
        data: {
          permissions: ['admin:manageRoles'],
        },
        loadComponent: () =>
          import('./role-list/role-list.component').then(
            (m) => m.RoleListComponent,
          ),
        path: 'roles',
      },
      {
        canActivate: [permissionGuard],
        data: {
          permissions: ['admin:manageRoles'],
        },
        loadComponent: () =>
          import('./role-create/role-create.component').then(
            (m) => m.RoleCreateComponent,
          ),
        path: 'roles/create',
      },
      {
        canActivate: [permissionGuard],
        data: {
          permissions: ['admin:manageRoles'],
        },
        loadComponent: () =>
          import('./role-details/role-details.component').then(
            (m) => m.RoleDetailsComponent,
          ),
        path: 'roles/:roleId',
      },
      {
        canActivate: [permissionGuard],
        data: {
          permissions: ['admin:manageRoles'],
        },
        loadComponent: () =>
          import('./role-edit/role-edit.component').then(
            (m) => m.RoleEditComponent,
          ),
        path: 'roles/:roleId/edit',
      },
      {
        canActivate: [permissionGuard],
        data: {
          permissions: ['admin:changeSettings'],
        },
        loadComponent: () =>
          import('./onboarding-settings/onboarding-settings.component').then(
            (m) => m.OnboardingSettingsComponent,
          ),
        path: 'onboarding',
      },
      {
        canActivate: [permissionGuard],
        canDeactivate: [tenantSettingsUnsavedChangesGuard],
        data: {
          permissions: ['admin:changeSettings'],
        },
        loadComponent: () =>
          import('./settings/appearance-settings.component').then(
            (m) => m.AppearanceSettingsComponent,
          ),
        path: 'settings/appearance',
      },
      {
        canActivate: [permissionGuard],
        canDeactivate: [tenantSettingsUnsavedChangesGuard],
        data: {
          permissions: ['admin:changeSettings'],
        },
        loadComponent: () =>
          import('./settings/legal-settings.component').then(
            (m) => m.LegalSettingsComponent,
          ),
        path: 'settings/legal',
      },
      {
        canActivate: [permissionGuard],
        canDeactivate: [tenantSettingsUnsavedChangesGuard],
        data: {
          permissions: ['admin:managePayments'],
        },
        loadComponent: () =>
          import('./settings/payment-provider-settings.component').then(
            (m) => m.PaymentProviderSettingsComponent,
          ),
        path: 'settings/payments',
      },
      {
        canActivate: [permissionGuard],
        canDeactivate: [tenantSettingsUnsavedChangesGuard],
        data: {
          permissions: ['admin:changeSettings'],
        },
        loadComponent: () =>
          import('./settings/registration-settings.component').then(
            (m) => m.RegistrationSettingsComponent,
          ),
        path: 'settings/registration',
      },
      {
        canActivate: [permissionGuard],
        canDeactivate: [tenantSettingsUnsavedChangesGuard],
        data: {
          permissions: ['admin:changeSettings'],
        },
        loadComponent: () =>
          import('./settings/organization-settings.component').then(
            (m) => m.OrganizationSettingsComponent,
          ),
        path: 'settings',
      },
      {
        canActivate: [permissionGuard],
        data: {
          permissions: ['admin:tax'],
        },
        loadComponent: () =>
          import('./tax-rates-settings/tax-rates-settings.component').then(
            (m) => m.TaxRatesSettingsComponent,
          ),
        path: 'tax-rates',
      },
      {
        canActivate: [permissionGuard],
        data: {
          permissions: ['users:viewAll'],
        },
        loadComponent: () =>
          import('./user-list/user-list.component').then(
            (m) => m.UserListComponent,
          ),
        path: 'users',
      },
      {
        canActivate: [permissionGuard],
        data: {
          permissions: ['events:review'],
        },
        loadComponent: () =>
          import('./event-reviews/event-reviews.component').then(
            (m) => m.EventReviewsComponent,
          ),
        path: 'event-reviews',
      },
    ],
    data: {
      anyPermissions: [
        'admin:manageRoles',
        'admin:changeSettings',
        'admin:managePayments',
        'admin:tax',
        'users:viewAll',
        'events:review',
      ],
    },
    loadComponent: () =>
      import('./admin-overview/admin-overview.component').then(
        (m) => m.AdminOverviewComponent,
      ),
    path: '',
  },
];
