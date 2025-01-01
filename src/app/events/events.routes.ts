import { Routes } from '@angular/router';

export const EVENT_ROUTES: Routes = [
  {path: '',
  pathMatch: 'full',
  redirectTo: 'list'},
  {
    loadComponent: () => import('./event-list/event-list.component').then(m => m.EventListComponent),
    path: 'list'
  }
] as const;
