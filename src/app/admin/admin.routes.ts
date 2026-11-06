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
        title: 'Roles',
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
        title: 'Create role',
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
        title: 'Role details',
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
        title: 'Edit role',
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
        title: 'Member onboarding',
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
        title: 'Appearance',
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
        title: 'Legal settings',
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
        title: 'Payment settings',
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
        title: 'Sign-up settings',
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
        title: 'Organization settings',
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
        title: 'Tax rates',
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
        title: 'Members',
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
        title: 'Event reviews',
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
