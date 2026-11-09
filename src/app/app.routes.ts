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
    title: 'Events',
  },
  {
    canActivate: [userAccountGuard, authGuard],
    children: TEMPLATE_ROUTES,
    path: 'templates',
    title: 'Templates',
  },
  {
    canActivate: [userAccountGuard, authGuard],
    children: INTERNAL_ROUTES,
    path: 'internal',
    title: 'Members hub',
  },
  {
    canActivate: [userAccountGuard, authGuard],
    children: PROFILE_ROUTES,
    path: 'profile',
    title: 'Profile',
  },
  {
    canActivate: [userAccountGuard, authGuard],
    children: ADMIN_ROUTES,
    path: 'admin',
    title: 'Organization settings',
  },
  {
    canActivate: [userAccountGuard, authGuard],
    children: FINANCE_ROUTES,
    path: 'finance',
    title: 'Finance',
  },
  {
    canActivate: [userAccountGuard, authGuard],
    children: SCANNING_ROUTES,
    path: 'scan',
    title: 'Check in',
  },
  {
    canActivate: [authGuard],
    children: GLOBAL_ADMIN_ROUTES,
    path: 'global-admin',
    title: 'Platform administration',
  },
  {
    data: { legalPage: 'imprint' },
    loadComponent: () =>
      import('./core/legal-page/legal-page.component').then(
        (m) => m.LegalPageComponent,
      ),
    path: 'legal/imprint',
    title: 'Imprint',
  },
  {
    data: { legalPage: 'privacy' },
    loadComponent: () =>
      import('./core/legal-page/legal-page.component').then(
        (m) => m.LegalPageComponent,
      ),
    path: 'legal/privacy',
    title: 'Privacy',
  },
  {
    data: { legalPage: 'terms' },
    loadComponent: () =>
      import('./core/legal-page/legal-page.component').then(
        (m) => m.LegalPageComponent,
      ),
    path: 'legal/terms',
    title: 'Terms',
  },
  {
    loadComponent: () =>
      import('./core/not-allowed/not-allowed.component').then(
        (m) => m.NotAllowedComponent,
      ),
    path: '403',
    title: 'Access unavailable',
  },
  {
    canActivate: [authGuard],
    loadComponent: () =>
      import('./core/create-account/create-account.component').then(
        (m) => m.CreateAccountComponent,
      ),
    path: 'create-account',
    title: 'Finish setup',
  },
  {
    canActivate: [userAccountGuard, authGuard],
    loadComponent: () =>
      import('./registration-transfers/registration-transfer-code-entry.component').then(
        (m) => m.RegistrationTransferCodeEntryComponent,
      ),
    path: 'registration-transfers',
    title: 'Ticket transfer',
  },
  {
    loadComponent: () =>
      import('./core/error/error.component').then((m) => m.ErrorComponent),
    path: '500',
    title: 'Something went wrong',
  },
  {
    loadComponent: () =>
      import('./core/not-found/not-found.component').then(
        (m) => m.NotFoundComponent,
      ),
    path: '404',
    title: 'Page not found',
  },
  { path: '**', redirectTo: '404' },
];
