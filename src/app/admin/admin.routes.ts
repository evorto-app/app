import { Routes } from '@angular/router';

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
        loadComponent: () =>
          import('./user-list/user-list.component').then(
            (m) => m.UserListComponent,
          ),
        path: 'users',
      },
    ],
    loadComponent: () =>
      import('./admin-overview/admin-overview.component').then(
        (m) => m.AdminOverviewComponent,
      ),
    path: '',
  },
];
