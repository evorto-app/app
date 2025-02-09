import { Routes } from '@angular/router';

import { ADMIN_ROUTES } from './admin/admin.routes';
import { authGuard } from './core/guards/auth.guard';
import { userAccountGuard } from './core/guards/user-account.guard';
import { EVENT_ROUTES } from './events/events.routes';
import { FINANCE_ROUTES } from './finance/finance.routes';
import { GLOBAL_ADMIN_ROUTES } from './global-admin/global-admin.routes';
import { INTERNAL_ROUTES } from './internal-pages/members-hub/internal.routes';
import { PROFILE_ROUTES } from './profile/profile.routes';
import { SCANNING_ROUTES } from './scanning/scanning.routes';
import { TEMPLATE_ROUTES } from './templates/templates.routes';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'events' },
  {
    canActivate: [userAccountGuard],
    children: EVENT_ROUTES,
    path: 'events',
  },
  {
    canActivate: [userAccountGuard, authGuard],
    children: TEMPLATE_ROUTES,
    path: 'templates',
  },
  {
    canActivate: [userAccountGuard, authGuard],
    children: INTERNAL_ROUTES,
    path: 'members-hub',
  },
  {
    canActivate: [userAccountGuard, authGuard],
    children: PROFILE_ROUTES,
    path: 'profile',
  },
  {
    canActivate: [userAccountGuard, authGuard],
    children: ADMIN_ROUTES,
    path: 'admin',
  },
  {
    canActivate: [userAccountGuard, authGuard],
    children: FINANCE_ROUTES,
    path: 'finance',
  },
  {
    canActivate: [userAccountGuard, authGuard],
    children: SCANNING_ROUTES,
    path: 'scan',
  },
  {
    canActivate: [authGuard],
    children: GLOBAL_ADMIN_ROUTES,
    path: 'global-admin',
  },
  {
    loadComponent: () =>
      import('./core/not-allowed/not-allowed.component').then(
        (m) => m.NotAllowedComponent,
      ),
    path: '403',
  },
  {
    loadComponent: () =>
      import('./core/create-account/create-account.component').then(
        (m) => m.CreateAccountComponent,
      ),
    path: 'create-account',
  },
];
