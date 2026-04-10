import { Routes } from '@angular/router';

export const INTERNAL_ROUTES: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'members-hub' },
  {
    loadComponent: () =>
      import('./members-hub.component').then((m) => m.MembersHubComponent),
    path: 'members-hub',
  },
];
