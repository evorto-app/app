import { Routes } from '@angular/router';

import { authGuard } from './core/auth.guard';
import { EVENT_ROUTES } from './events/events.routes';
import { GLOBAL_ADMIN_ROUTES } from './global-admin/global-admin.routes';
import { TEMPLATE_ROUTES } from './templates/templates.routes';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'events' },
  {
    children: EVENT_ROUTES,
    path: 'events',
  },
  {
    canActivate: [authGuard],
    children: TEMPLATE_ROUTES,
    path: 'templates',
  },
  {
    children: GLOBAL_ADMIN_ROUTES,
    path: 'global-admin',
  },
];
