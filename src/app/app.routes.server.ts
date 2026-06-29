import { RenderMode, ServerRoute } from '@angular/ssr';

export const serverRoutes: ServerRoute[] = [
  {
    // Organizer uses browser-only receipt upload/dialog flows; keep the first
    // document response fast and let the hydrated app load the organizer data.
    path: 'events/:eventId/organize',
    renderMode: RenderMode.Client,
  },
  {
    path: '**',
    renderMode: RenderMode.Server,
  },
];
