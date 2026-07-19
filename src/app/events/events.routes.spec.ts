import { EVENT_ROUTES } from './events.routes';
import { eventEditGuard } from './guards/event-edit.guard';
import { eventOrganizerGuard } from './guards/event-organizer.guard';

describe('EVENT_ROUTES', () => {
  const eventRoutes = EVENT_ROUTES[0]?.children ?? [];

  it('executes the organizer and edit guards directly', () => {
    expect(
      eventRoutes.find((route) => route.path === ':eventId/organize')
        ?.canActivate,
    ).toEqual([eventOrganizerGuard]);
    expect(
      eventRoutes.find((route) => route.path === ':eventId/edit')?.canActivate,
    ).toEqual([eventEditGuard]);
  });
});
