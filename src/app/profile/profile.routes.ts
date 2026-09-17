import { Routes } from '@angular/router';

export const PROFILE_ROUTES: Routes = [
  {
    children: [
      {
        loadComponent: () =>
          import('./user-profile/user-profile.component').then(
            (m) => m.UserProfileComponent,
          ),
        path: '',
        pathMatch: 'full',
      },
      {
        loadComponent: () =>
          import('./profile-events/profile-events.component').then(
            (m) => m.ProfileEventsComponent,
          ),
        path: 'events',
      },
      {
        loadComponent: () =>
          import('./profile-discounts/profile-discounts.component').then(
            (m) => m.ProfileDiscountsComponent,
          ),
        path: 'discounts',
      },
      {
        loadComponent: () =>
          import('./profile-receipts/profile-receipts.component').then(
            (m) => m.ProfileReceiptsComponent,
          ),
        path: 'receipts',
      },
    ],
    loadComponent: () =>
      import('./profile-shell/profile-shell.component').then(
        (m) => m.ProfileShellComponent,
      ),
    path: '',
  },
];
