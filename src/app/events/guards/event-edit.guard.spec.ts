import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  provideRouter,
  Router,
  RouterStateSnapshot,
  UrlTree,
} from '@angular/router';
import { firstValueFrom, isObservable } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { APP_RPC_CLIENT } from '../../core/effect-rpc-angular-client';
import { PermissionsService } from '../../core/permissions.service';
import { eventEditGuard } from './event-edit.guard';

const state = { url: '/events/event-1/edit' } as RouterStateSnapshot;
const route = (eventId?: string): ActivatedRouteSnapshot =>
  ({
    params: eventId ? { eventId } : {},
  }) as ActivatedRouteSnapshot;

describe('eventEditGuard', () => {
  const findOne = vi.fn();
  let canEditAll = false;

  beforeEach(() => {
    canEditAll = false;
    findOne.mockReset();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: APP_RPC_CLIENT,
          useValue: {
            events: {
              findOne: {
                call: findOne,
              },
            },
          },
        },
        {
          provide: PermissionsService,
          useValue: {
            hasPermissionSync: () => canEditAll,
          },
        },
      ],
    });
  });

  const runGuard = async (eventId?: string) => {
    const result = TestBed.runInInjectionContext(() =>
      eventEditGuard(route(eventId), state),
    );
    return isObservable(result) ? firstValueFrom(result) : await result;
  };

  it('uses a fresh server-derived creator result on every navigation', async () => {
    findOne
      .mockResolvedValueOnce({
        status: 'DRAFT',
        userIsCreator: true,
      })
      .mockResolvedValueOnce({
        status: 'DRAFT',
        userIsCreator: false,
      });

    expect(await runGuard('event-1')).toBe(true);

    const denied = await runGuard('event-1');
    expect(denied).toBeInstanceOf(UrlTree);
    expect(TestBed.inject(Router).serializeUrl(denied as UrlTree)).toBe('/403');
    expect(findOne).toHaveBeenCalledTimes(2);
    expect(findOne).toHaveBeenNthCalledWith(1, { id: 'event-1' });
    expect(findOne).toHaveBeenNthCalledWith(2, { id: 'event-1' });
  });

  it('allows an all-events editor without exposing the creator identifier', async () => {
    canEditAll = true;
    findOne.mockResolvedValue({
      status: 'DRAFT',
      userIsCreator: false,
    });

    expect(await runGuard('event-1')).toBe(true);
  });

  it('redirects an authorized editor when the freshly loaded event is locked', async () => {
    findOne.mockResolvedValue({
      status: 'APPROVED',
      userIsCreator: true,
    });

    const result = await runGuard('event-1');
    expect(result).toBeInstanceOf(UrlTree);
    expect(TestBed.inject(Router).serializeUrl(result as UrlTree)).toBe(
      '/events/event-1?error=event-locked',
    );
  });

  it('fails closed before an RPC call when the route has no event id', async () => {
    const result = await runGuard();

    expect(result).toBeInstanceOf(UrlTree);
    expect(TestBed.inject(Router).serializeUrl(result as UrlTree)).toBe('/404');
    expect(findOne).not.toHaveBeenCalled();
  });
});
