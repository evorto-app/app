import { Routes } from '@angular/router';

import { CATEGORY_ROUTES } from './categories/categories.routes';

export const TEMPLATE_ROUTES: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'list' },
  {
    loadComponent: () =>
      import('./template-list/template-list.component').then(
        (m) => m.TemplateListComponent,
      ),
    path: 'list',
  },
  {
    children: CATEGORY_ROUTES,
    path: 'categories',
  },
];
