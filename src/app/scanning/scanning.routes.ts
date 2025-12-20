import { Routes } from '@angular/router';

export const SCANNING_ROUTES: Routes = [
  {
    loadComponent: () => import('./scanner/scanner.component').then((m) => m.ScannerComponent),
    path: '',
    pathMatch: 'full',
  },
  {
    loadComponent: () =>
      import('./handle-registration/handle-registration.component').then(
        (m) => m.HandleRegistrationComponent,
      ),
    path: 'registration/:registrationId',
  },
];
