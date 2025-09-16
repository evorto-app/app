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
  {
    loadComponent: () =>
      import('./discount-cards/discount-cards.component').then(
        (m) => m.DiscountCardsComponent,
      ),
    path: 'discount-cards',
  },
];
