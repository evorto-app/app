import { Routes } from '@angular/router';

import { permissionGuard } from '../core/guards/permission.guard';
import { templateTitleResolver } from './template-title.resolver';

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
        title: 'Create template',
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
        title: 'Create template',
      },
      {
        loadComponent: () =>
          import('./categories/category-list/category-list.component').then(
            (m) => m.CategoryListComponent,
          ),
        path: 'categories',
        title: 'Template categories',
      },
      {
        loadComponent: () =>
          import('./template-details/template-details.component').then(
            (m) => m.TemplateDetailsComponent,
          ),
        path: ':templateId',
        title: templateTitleResolver,
      },
      {
        canActivate: [permissionGuard],
        data: {
          permissions: ['templates:editAll', 'templates:view'],
          templateTitleAction: 'Edit template:',
        },
        loadComponent: () =>
          import('./template-edit/template-edit.component').then(
            (m) => m.TemplateEditComponent,
          ),

        path: ':templateId/edit',
        title: templateTitleResolver,
      },
      {
        canActivate: [permissionGuard],
        data: {
          permissions: ['events:create'],
          templateTitleAction: 'Create event from',
        },
        loadComponent: () =>
          import('./template-create-event/template-create-event.component').then(
            (m) => m.TemplateCreateEventComponent,
          ),
        path: ':templateId/create-event',
        title: templateTitleResolver,
      },
    ],
    loadComponent: () =>
      import('./template-list/template-list.component').then(
        (m) => m.TemplateListComponent,
      ),
    path: '',
  },
];
