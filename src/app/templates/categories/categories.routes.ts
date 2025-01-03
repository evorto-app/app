import { Routes } from '@angular/router';

export const CATEGORY_ROUTES: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'list' },
  {
    loadComponent: () =>
      import('./category-list/category-list.component').then(
        (m) => m.CategoryListComponent,
      ),
    path: 'list',
  },
];
