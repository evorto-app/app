import { Routes } from '@angular/router';

import { permissionGuard } from '../core/guards/permission.guard';

export const ADMIN_ROUTES: Routes = [
  {
    children: [
      {
        loadComponent: () =>
          import('./role-list/role-list.component').then(
            (m) => m.RoleListComponent,
          ),
        path: 'roles',
      },
      {
        loadComponent: () =>
          import('./role-create/role-create.component').then(
            (m) => m.RoleCreateComponent,
          ),
        path: 'roles/create',
      },
      {
        loadComponent: () =>
          import('./role-details/role-details.component').then(
            (m) => m.RoleDetailsComponent,
          ),
        path: 'roles/:roleId',
      },
      {
        loadComponent: () =>
          import('./role-edit/role-edit.component').then(
            (m) => m.RoleEditComponent,
          ),
        path: 'roles/:roleId/edit',
      },
      {
        loadComponent: () =>
          import('./general-settings/general-settings.component').then(
            (m) => m.GeneralSettingsComponent,
          ),
        path: 'settings',
      },
      {
        canActivate: [permissionGuard],
        data: {
          permissions: ['admin:changeSettings'],
        },
        loadComponent: () =>
          import('./discount-settings/discount-settings.component').then(
            (m) => m.DiscountSettingsComponent,
          ),
        path: 'settings/discounts',
      },
      {
        canActivate: [permissionGuard],
        data: {
          permissions: ['admin:manageTaxes'],
        },
        loadComponent: () =>
          import('./tax-rates-settings/tax-rates-settings.component').then(
            (m) => m.TaxRatesSettingsComponent,
          ),
        path: 'tax-rates',
      },
      {
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
    loadComponent: () =>
      import('./admin-overview/admin-overview.component').then(
        (m) => m.AdminOverviewComponent,
      ),
    path: '',
  },
];
