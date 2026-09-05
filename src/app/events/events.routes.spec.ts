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
import { EventNotFoundError } from '../../shared/rpc-contracts/app-rpcs/events.errors';
import { APP_RPC_CLIENT } from '../core/effect-rpc-angular-client';
import { PermissionsService } from '../core/permissions.service';
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
  const maybeSelf = vi.fn<() => Promise<null | { id: string }>>();
  const canOrganize = vi.fn<() => Promise<boolean>>();
  const hasPermissionSync = vi.fn<PermissionsService['hasPermissionSync']>();

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
    maybeSelf.mockReset().mockResolvedValue({ id: 'creator-1' });
    canOrganize.mockReset().mockResolvedValue(true);
    hasPermissionSync.mockReset().mockReturnValue(false);
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: QueryClient, useValue: queryClient },
        {
          provide: PermissionsService,
          useValue: { hasPermissionSync } satisfies Pick<
            PermissionsService,
            'hasPermissionSync'
          >,
        },
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
              findOne: {
                queryOptions: ({ id }: { id: string }) => ({
                  queryFn: findEvent,
                  queryKey: ['events', 'findOne', id],
                }),
              },
            },
            users: { maybeSelf: { call: maybeSelf } },
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
      findEvent.mockRejectedValue(error);

      expect(destination(await activate(guard))).toBe(path);
      expect(findEvent).toHaveBeenCalledOnce();
      expect(canOrganize).not.toHaveBeenCalled();
    });
  }

  it('allows the creator of a cached draft without edit-all permission', async () => {
    expect(await activate(eventEditGuard)).toBe(true);
    expect(await activate(eventEditGuard)).toBe(true);
    expect(findEvent).toHaveBeenCalledOnce();
    expect(maybeSelf).toHaveBeenCalledTimes(2);
    expect(hasPermissionSync).toHaveBeenCalledWith('events:editAll');
  });

  it.each([{ id: 'other-user' }, null])(
    'denies a noncreator without edit-all permission',
    async (self) => {
      maybeSelf.mockResolvedValue(self);
      expect(destination(await activate(eventEditGuard))).toBe('/403');
    },
  );

  it('allows edit-all permission while preserving the event lock redirect', async () => {
    maybeSelf.mockResolvedValue({ id: 'other-user' });
    hasPermissionSync.mockReturnValue(true);
    expect(await activate(eventEditGuard)).toBe(true);
    queryClient.setQueryData(['events', 'findOne', 'event-1'], {
      creatorId: 'creator-1',
      status: 'PUBLISHED',
    });

    expect(destination(await activate(eventEditGuard))).toBe(
      '/events/event-1?error=event-locked',
    );
    expect(findEvent).toHaveBeenCalledOnce();
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
      expect(maybeSelf).not.toHaveBeenCalled();
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
    expect(maybeSelf).not.toHaveBeenCalled();
    expect(findEvent).not.toHaveBeenCalled();
    expect(canOrganize).not.toHaveBeenCalled();
    expect(hasPermissionSync).not.toHaveBeenCalled();
    expect(queryClient.getQueryCache().getAll()).toEqual([]);
  });
});
