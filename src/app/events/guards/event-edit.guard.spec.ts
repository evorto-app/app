import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, UrlTree } from '@angular/router';
import { RpcForbiddenError } from '@shared/errors/rpc-errors';
import { MAX_REGISTRATION_QUESTIONS } from '@shared/registration-question-limits';
import {
  EventConflictError,
  EventNotFoundError,
} from '@shared/rpc-contracts/app-rpcs/events.errors';
import { type EventGraphEditRecord } from '@shared/rpc-contracts/app-rpcs/events.rpcs';
import {
  provideTanStackQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { APP_RPC_CLIENT, AppRpc } from '../../core/effect-rpc-angular-client';
import { PermissionsService } from '../../core/permissions.service';
import { eventEditGuard } from './event-edit.guard';

type EditQueryOptions = RpcClient['events']['findGraphForEdit']['queryOptions'];
type PublicQueryOptions = RpcClient['events']['findOne']['queryOptions'];
type RpcClient = ReturnType<typeof AppRpc.injectClient>;

const findGraphForEdit = vi.fn<() => Promise<EventGraphEditRecord>>();
const editQueryOptions = vi.fn(
  (input: Parameters<EditQueryOptions>[0]): ReturnType<EditQueryOptions> => ({
    queryFn: findGraphForEdit,
    queryKey: [['events', 'findGraphForEdit'], { input, type: 'query' }],
  }),
);
const findPublicEvent = vi.fn<() => Promise<never>>();
const publicQueryOptions = vi.fn(
  (
    input: Parameters<PublicQueryOptions>[0],
  ): ReturnType<PublicQueryOptions> => ({
    queryFn: findPublicEvent,
    queryKey: [['events', 'findOne'], { input, type: 'query' }],
  }),
);
const maybeSelf = vi.fn<() => Promise<null>>();
const hasPermissionSync = vi.fn<PermissionsService['hasPermissionSync']>();

const editableGraph: EventGraphEditRecord = {
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
};

const runGuard = (eventId: null | string = 'event-1') => {
  const state = TestBed.inject(Router).routerState.snapshot;
  state.root.params = eventId === null ? {} : { eventId };
  return TestBed.runInInjectionContext(() => eventEditGuard(state.root, state));
};

const expectRedirect = (
  result: Awaited<ReturnType<typeof runGuard>>,
  url: string,
) => {
  expect(result).toBeInstanceOf(UrlTree);
  if (!(result instanceof UrlTree)) {
    throw new TypeError('Expected the event edit guard to return a URL tree');
  }
  expect(TestBed.inject(Router).serializeUrl(result)).toBe(url);
};

describe('eventEditGuard', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    findGraphForEdit.mockResolvedValue(editableGraph);
    findPublicEvent.mockRejectedValue(
      new Error('Public event query is unavailable'),
    );
    maybeSelf.mockResolvedValue(null);
    hasPermissionSync.mockReturnValue(true);
    queryClient = new QueryClient({
      defaultOptions: { queries: { gcTime: 0, retry: false } },
    });
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideTanStackQuery(queryClient),
        {
          provide: APP_RPC_CLIENT,
          useValue: {
            events: {
              findGraphForEdit: { queryOptions: editQueryOptions },
              findOne: { queryOptions: publicQueryOptions },
            },
            users: { maybeSelf: { call: maybeSelf } },
          },
        },
        {
          provide: PermissionsService,
          useValue: { hasPermissionSync } satisfies Pick<
            PermissionsService,
            'hasPermissionSync'
          >,
        },
      ],
    });
  });

  afterEach(() => {
    queryClient.clear();
    TestBed.resetTestingModule();
  });

  it('redirects a missing event ID without making an RPC call', async () => {
    expectRedirect(await runGuard(null), '/404');
    expect(editQueryOptions).not.toHaveBeenCalled();
    expect(publicQueryOptions).not.toHaveBeenCalled();
    expect(maybeSelf).not.toHaveBeenCalled();
  });

  it('allows an edit authorized by the protected event graph query', async () => {
    expect(await runGuard()).toBe(true);
    expect(editQueryOptions).toHaveBeenCalledExactlyOnceWith({ id: 'event-1' });
    expect(findGraphForEdit).toHaveBeenCalledTimes(1);
    expect(publicQueryOptions).not.toHaveBeenCalled();
    expect(maybeSelf).not.toHaveBeenCalled();
    expect(hasPermissionSync).not.toHaveBeenCalled();
  });

  it('keeps authorized repair accessible when stored questions exceed the public limit', async () => {
    findGraphForEdit.mockResolvedValue({
      ...editableGraph,
      questions: Array.from(
        { length: MAX_REGISTRATION_QUESTIONS + 1 },
        (_, index) => ({
          description: null,
          id: `question-${index}`,
          registrationOptionId: 'option-1',
          required: true,
          sortOrder: index,
          title: `Question ${index}`,
        }),
      ),
    });

    expect(await runGuard()).toBe(true);
    expect(editQueryOptions).toHaveBeenCalledExactlyOnceWith({ id: 'event-1' });
    expect(publicQueryOptions).not.toHaveBeenCalled();
    expect(findPublicEvent).not.toHaveBeenCalled();
    expect(maybeSelf).not.toHaveBeenCalled();
    expect(hasPermissionSync).not.toHaveBeenCalled();
  });

  it('redirects a server-denied editor to the forbidden page', async () => {
    findGraphForEdit.mockRejectedValue(
      new RpcForbiddenError({ message: 'Forbidden' }),
    );

    expectRedirect(await runGuard(), '/403');
  });

  it('redirects a locked event to its detail page with an explicit reason', async () => {
    findGraphForEdit.mockRejectedValue(
      new EventConflictError({ message: 'Event is locked' }),
    );

    expectRedirect(await runGuard(), '/events/event-1?error=event-locked');
  });

  it.each([
    {
      error: new EventNotFoundError({
        id: 'event-1',
        message: 'Event not found',
      }),
      path: '/404',
    },
    { error: { _tag: 'RpcUnauthorizedError' }, path: '/403' },
    { error: new Error('RPC transport unavailable'), path: '/500' },
    { error: null, path: '/500' },
    { error: { _tag: 42 }, path: '/500' },
  ])('routes server failures to $path', async ({ error, path }) => {
    findGraphForEdit.mockRejectedValue(error);
    expectRedirect(await runGuard(), path);
    expect(findGraphForEdit).toHaveBeenCalledTimes(1);
  });
});
