import { Routes } from '@angular/router';

import { permissionGuard } from '../../core/guards/permission.guard';

export const INTERNAL_ROUTES: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'members-hub' },
  {
    canActivate: [permissionGuard],
    data: {
      permissions: ['internal:viewInternalPages'],
    },
    loadComponent: () =>
      import('./members-hub.component').then((m) => m.MembersHubComponent),
    path: 'members-hub',
  },
];
