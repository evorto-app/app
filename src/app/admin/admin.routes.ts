import { Routes } from '@angular/router';

import { permissionGuard } from '../core/guards/permission.guard';

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
        data: {
          permissions: ['admin:changeSettings'],
        },
        loadComponent: () =>
          import('./general-settings/general-settings.component').then(
            (m) => m.GeneralSettingsComponent,
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
