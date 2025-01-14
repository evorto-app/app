import { Routes } from '@angular/router';

import { CATEGORY_ROUTES } from './categories/categories.routes';

export const TEMPLATE_ROUTES: Routes = [
  {
    children: CATEGORY_ROUTES,
    path: 'categories',
  },
  {
    children: [
      {
        loadComponent: () =>
          import('./template-create/template-create.component').then(
            (m) => m.TemplateCreateComponent,
          ),
        path: 'create',
      },
      {
        loadComponent: () =>
          import('./template-create/template-create.component').then(
            (m) => m.TemplateCreateComponent,
          ),
        path: 'create/:categoryId',
      },
      {
        loadComponent: () =>
          import('./template-details/template-details.component').then(
            (m) => m.TemplateDetailsComponent,
          ),
        path: ':templateId',
      },
      {
        loadComponent: () =>
          import('./template-edit/template-edit.component').then(
            (m) => m.TemplateEditComponent,
          ),

        path: ':templateId/edit',
      },
      {
        loadComponent: () =>
          import(
            './template-create-event/template-create-event.component'
          ).then((m) => m.TemplateCreateEventComponent),
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
