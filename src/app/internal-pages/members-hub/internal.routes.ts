import { Routes } from '@angular/router';

export const INTERNAL_ROUTES: Routes = [
  {
    loadComponent: () =>
      import('./members-hub.component').then((m) => m.MembersHubComponent),
    path: '',
  },
];
