import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  CanActivateFn,
  provideRouter,
  Router,
  UrlTree,
} from '@angular/router';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  RpcForbiddenError,
  RpcUnauthorizedError,
} from '../../shared/errors/rpc-errors';
import {
  EventConflictError,
  EventNotFoundError,
} from '../../shared/rpc-contracts/app-rpcs/events.errors';
import { type EventGraphEditRecord } from '../../shared/rpc-contracts/app-rpcs/events.rpcs';
import { APP_RPC_CLIENT, AppRpc } from '../core/effect-rpc-angular-client';
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

describe('event route access outcomes', () => {
  let queryClient: QueryClient;
  const findEvent =
    vi.fn<() => Promise<{ creatorId: string; status: string }>>();
  type EditQueryOptions = ReturnType<
    typeof AppRpc.injectClient
  >['events']['findGraphForEdit']['queryOptions'];
  const findGraphForEdit = vi.fn<() => Promise<EventGraphEditRecord>>();
  const editQueryOptions = (
    input: Parameters<EditQueryOptions>[0],
  ): ReturnType<EditQueryOptions> => ({
    queryFn: findGraphForEdit,
    queryKey: [['events', 'findGraphForEdit'], { input, type: 'query' }],
  });
  const canOrganize = vi.fn<() => Promise<boolean>>();

  const activate = async (guard: CanActivateFn, eventId = 'event-1') => {
    const route = new ActivatedRouteSnapshot();
    route.params = { eventId };
    const router = TestBed.inject(Router);
    return TestBed.runInInjectionContext(() =>
      guard(route, router.routerState.snapshot),
    );
  };
  const destination = (result: unknown) => {
    if (!(result instanceof UrlTree)) {
      throw new TypeError('Expected the guard to return a redirect');
    }
    return TestBed.inject(Router).serializeUrl(result);
  };

  beforeEach(() => {
    findEvent.mockReset().mockResolvedValue({
      creatorId: 'creator-1',
      status: 'DRAFT',
    });
    findGraphForEdit.mockReset().mockResolvedValue({
      addOns: [],
      description: 'Draft event',
      end: '2026-10-01T22:00:00.000Z',
      icon: { iconColor: 2, iconName: 'calendar:fas' },
      id: 'event-1',
      location: null,
      questions: [],
      registrationOptions: [],
      simpleModeEnabled: false,
      start: '2026-10-01T18:00:00.000Z',
      title: 'Draft event',
    });
    canOrganize.mockReset().mockResolvedValue(true);
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: QueryClient, useValue: queryClient },
        {
          provide: APP_RPC_CLIENT,
          useValue: {
            events: {
              canOrganize: {
                queryOptions: ({ eventId }: { eventId: string }) => ({
                  queryFn: canOrganize,
                  queryKey: ['events', 'canOrganize', eventId],
                }),
              },
              findGraphForEdit: { queryOptions: editQueryOptions },
              findOne: {
                queryOptions: ({ id }: { id: string }) => ({
                  queryFn: findEvent,
                  queryKey: ['events', 'findOne', id],
                }),
              },
            },
          },
        },
      ],
    });
  });

  afterEach(() => {
    queryClient.clear();
    TestBed.resetTestingModule();
  });

  for (const [name, guard] of [
    ['edit', eventEditGuard],
    ['organize', eventOrganizerGuard],
  ] satisfies [string, CanActivateFn][]) {
    it.each([
      {
        error: new EventNotFoundError({ message: 'Event unavailable' }),
        path: '/404',
      },
      {
        error: new RpcForbiddenError({ message: 'Access denied' }),
        path: '/403',
      },
      {
        error: new RpcUnauthorizedError({ message: 'Sign in required' }),
        path: '/403',
      },
      { error: new Error('EventNotFoundError'), path: '/500' },
    ])(`routes ${name} lookup errors to $path`, async ({ error, path }) => {
      const lookup = name === 'edit' ? findGraphForEdit : findEvent;
      const otherLookup = name === 'edit' ? findEvent : findGraphForEdit;
      lookup.mockRejectedValue(error);

      expect(destination(await activate(guard))).toBe(path);
      expect(lookup).toHaveBeenCalledOnce();
      expect(otherLookup).not.toHaveBeenCalled();
      expect(canOrganize).not.toHaveBeenCalled();
    });
  }

  it('reuses a cached edit authorized by the protected graph query', async () => {
    expect(await activate(eventEditGuard)).toBe(true);
    expect(await activate(eventEditGuard)).toBe(true);
    expect(findGraphForEdit).toHaveBeenCalledOnce();
    expect(
      queryClient.getQueryData(editQueryOptions({ id: 'event-1' }).queryKey),
    ).toMatchObject({ id: 'event-1' });
    expect(findEvent).not.toHaveBeenCalled();
    expect(canOrganize).not.toHaveBeenCalled();
  });

  it.each([
    new RpcForbiddenError({ message: 'Editor access denied' }),
    new RpcUnauthorizedError({ message: 'Sign in required' }),
  ])(
    'rejects a protected edit denial despite a cached public draft',
    async (error) => {
      queryClient.setQueryData(['events', 'findOne', 'event-1'], {
        creatorId: 'creator-1',
        status: 'DRAFT',
      });
      findGraphForEdit.mockRejectedValue(error);

      expect(destination(await activate(eventEditGuard))).toBe('/403');
      expect(findGraphForEdit).toHaveBeenCalledOnce();
      expect(findEvent).not.toHaveBeenCalled();
    },
  );

  it('preserves the server lock redirect despite a cached public draft', async () => {
    queryClient.setQueryData(['events', 'findOne', 'event-1'], {
      creatorId: 'creator-1',
      status: 'DRAFT',
    });
    findGraphForEdit.mockRejectedValue(
      new EventConflictError({ message: 'Event is locked' }),
    );

    expect(destination(await activate(eventEditGuard))).toBe(
      '/events/event-1?error=event-locked',
    );
    expect(findGraphForEdit).toHaveBeenCalledOnce();
    expect(findEvent).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    'uses cached organizer access when permission is %s',
    async (allowed) => {
      canOrganize.mockResolvedValue(allowed);
      for (let visit = 0; visit < 2; visit += 1) {
        const result = await activate(eventOrganizerGuard);
        expect(result === true ? result : destination(result)).toBe(
          allowed ? true : '/403',
        );
      }
      expect(findEvent).toHaveBeenCalledOnce();
      expect(canOrganize).toHaveBeenCalledOnce();
      expect(findGraphForEdit).not.toHaveBeenCalled();
    },
  );

  it('maps a typed denial from the organizer-access query', async () => {
    canOrganize.mockRejectedValue(
      new RpcForbiddenError({ message: 'Organizer access denied' }),
    );

    expect(destination(await activate(eventOrganizerGuard))).toBe('/403');
    expect(findEvent).toHaveBeenCalledOnce();
    expect(canOrganize).toHaveBeenCalledOnce();
  });

  it('fails closed before any RPC read when the event id is missing', async () => {
    const route = new ActivatedRouteSnapshot();
    route.params = {};
    const router = TestBed.inject(Router);

    const result = await TestBed.runInInjectionContext(() =>
      eventEditGuard(route, router.routerState.snapshot),
    );

    expect(destination(result)).toBe('/404');
    expect(findGraphForEdit).not.toHaveBeenCalled();
    expect(findEvent).not.toHaveBeenCalled();
    expect(canOrganize).not.toHaveBeenCalled();
    expect(queryClient.getQueryCache().getAll()).toEqual([]);
  });
});
