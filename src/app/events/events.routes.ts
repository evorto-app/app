import { Routes } from '@angular/router';

import { eventEditGuard } from './guards/event-edit.guard';
import { eventOrganizerGuard } from './guards/event-organizer.guard';

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
      {
        canActivate: [eventOrganizerGuard],
        loadComponent: () =>
          import('./event-organize/event-organize').then(
            (m) => m.EventOrganize,
          ),
        path: ':eventId/organize',
      },
      {
        canActivate: [eventEditGuard],
        loadComponent: () =>
          import('./event-edit/event-edit').then((m) => m.EventEdit),
        path: ':eventId/edit',
      },
    ],
    loadComponent: () =>
      import('./event-list/event-list.component').then(
        (m) => m.EventListComponent,
      ),
    path: '',
  },
] as const;
