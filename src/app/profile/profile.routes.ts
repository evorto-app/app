import { Routes } from '@angular/router';

export const PROFILE_ROUTES: Routes = [
  {
    loadComponent: () =>
      import('./user-profile/user-profile.component').then(
        (m) => m.UserProfileComponent,
      ),
    path: '',
    pathMatch: 'full',
  },
];
