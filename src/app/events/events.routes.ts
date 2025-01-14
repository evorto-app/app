import { Routes } from '@angular/router';

export const EVENT_ROUTES: Routes = [
  {
    children: [
      {
        loadComponent: () =>
          import('./event-details/event-details.component').then(
            (m) => m.EventDetailsComponent,
          ),
        path: ':eventId',
      },
    ],
    loadComponent: () =>
      import('./event-list/event-list.component').then(
        (m) => m.EventListComponent,
      ),
    path: '',
  },
] as const;
