import { Routes } from '@angular/router';

import { permissionGuard } from '../core/guards/permission.guard';

export const TEMPLATE_ROUTES: Routes = [
  {
    children: [
      {
        canActivate: [permissionGuard],
        data: {
          permissions: ['templates:create', 'templates:view'],
        },
        loadComponent: () =>
          import('./template-create/template-create.component').then(
            (m) => m.TemplateCreateComponent,
          ),
        path: 'create',
      },
      {
        canActivate: [permissionGuard],
        data: {
          permissions: ['templates:create', 'templates:view'],
        },
        loadComponent: () =>
          import('./template-create/template-create.component').then(
            (m) => m.TemplateCreateComponent,
          ),
        path: 'create/:categoryId',
      },
      {
        loadComponent: () =>
          import('./categories/category-list/category-list.component').then(
            (m) => m.CategoryListComponent,
          ),
        path: 'categories',
      },
      {
        loadComponent: () =>
          import('./template-details/template-details.component').then(
            (m) => m.TemplateDetailsComponent,
          ),
        path: ':templateId',
      },
      {
        canActivate: [permissionGuard],
        data: {
          permissions: ['templates:editAll', 'templates:view'],
        },
        loadComponent: () =>
          import('./template-edit/template-edit.component').then(
            (m) => m.TemplateEditComponent,
          ),

        path: ':templateId/edit',
      },
      {
        canActivate: [permissionGuard],
        data: {
          permissions: ['events:create'],
        },
        loadComponent: () =>
          import('./template-create-event/template-create-event.component').then(
            (m) => m.TemplateCreateEventComponent,
          ),
        path: ':templateId/create-event',
      },
    ],
    loadComponent: () =>
      import('./template-list/template-list.component').then(
        (m) => m.TemplateListComponent,
      ),
    path: '',
  },
];
