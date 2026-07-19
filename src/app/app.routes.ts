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
    path: 'internal',
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
    data: { legalPage: 'imprint' },
    loadComponent: () =>
      import('./core/legal-page/legal-page.component').then(
        (m) => m.LegalPageComponent,
      ),
    path: 'legal/imprint',
  },
  {
    data: { legalPage: 'privacy' },
    loadComponent: () =>
      import('./core/legal-page/legal-page.component').then(
        (m) => m.LegalPageComponent,
      ),
    path: 'legal/privacy',
  },
  {
    data: { legalPage: 'terms' },
    loadComponent: () =>
      import('./core/legal-page/legal-page.component').then(
        (m) => m.LegalPageComponent,
      ),
    path: 'legal/terms',
  },
  {
    loadComponent: () =>
      import('./core/not-allowed/not-allowed.component').then(
        (m) => m.NotAllowedComponent,
      ),
    path: '403',
  },
  {
    canActivate: [authGuard],
    loadComponent: () =>
      import('./core/create-account/create-account.component').then(
        (m) => m.CreateAccountComponent,
      ),
    path: 'create-account',
  },
  {
    canActivate: [userAccountGuard, authGuard],
    loadComponent: () =>
      import('./registration-transfers/registration-transfer-code-entry.component').then(
        (m) => m.RegistrationTransferCodeEntryComponent,
      ),
    path: 'registration-transfers',
  },
  {
    canActivate: [userAccountGuard, authGuard],
    loadComponent: () =>
      import('./registration-transfers/registration-transfer-claim.component').then(
        (m) => m.RegistrationTransferClaimComponent,
      ),
    path: 'registration-transfers/:credential',
  },
  {
    loadComponent: () =>
      import('./core/error/error.component').then((m) => m.ErrorComponent),
    path: '500',
  },
  {
    loadComponent: () =>
      import('./core/not-found/not-found.component').then(
        (m) => m.NotFoundComponent,
      ),
    path: '404',
  },
  { path: '**', redirectTo: '404' },
];
