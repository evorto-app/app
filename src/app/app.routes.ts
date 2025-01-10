import { Routes } from '@angular/router';

import { ADMIN_ROUTES } from './admin/admin.routes';
import { authGuard } from './core/auth.guard';
import { EVENT_ROUTES } from './events/events.routes';
import { GLOBAL_ADMIN_ROUTES } from './global-admin/global-admin.routes';
import { PROFILE_ROUTES } from './profile/profile.routes';
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
    canActivate: [authGuard],
    children: PROFILE_ROUTES,
    path: 'profile',
  },
  {
    canActivate: [authGuard],
    children: ADMIN_ROUTES,
    path: 'admin',
  },
  {
    children: GLOBAL_ADMIN_ROUTES,
    path: 'global-admin',
  },
];
