import { Routes } from '@angular/router';

import type { HandleRegistrationComponent } from './handle-registration/handle-registration.component';

export const SCANNING_ROUTES: Routes = [
  {
    loadComponent: () =>
      import('./scanner/scanner.component').then((m) => m.ScannerComponent),
    path: '',
    pathMatch: 'full',
  },
  {
    canDeactivate: [
      (component: HandleRegistrationComponent) => component.canLeaveTicket(),
    ],
    loadComponent: () =>
      import('./handle-registration/handle-registration.component').then(
        (m) => m.HandleRegistrationComponent,
      ),
    path: 'registration/:registrationId',
    title: 'Check-in pass',
  },
];
