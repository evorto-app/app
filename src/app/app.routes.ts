import { Routes } from '@angular/router';

import { EVENT_ROUTES } from './events/events.routes';
import { GLOBAL_ADMIN_ROUTES } from './global-admin/global-admin.routes';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'events' },
  {
    children: EVENT_ROUTES,
    path: 'events',
  },
  {
    children: GLOBAL_ADMIN_ROUTES,
    path: 'global-admin',
  },
];
