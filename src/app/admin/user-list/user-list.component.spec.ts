import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  provideTanStackQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NotificationService } from '../../core/notification.service';
import { PermissionsService } from '../../core/permissions.service';
import { UserListComponent, UserListOperations } from './user-list.component';

const findUsers = vi.fn();
const findRoles = vi.fn();
const canAssignRoles = signal(false);

const normalizeText = (fixture: ComponentFixture<UserListComponent>) =>
  fixture.nativeElement.textContent.replaceAll(/\s+/g, ' ').trim();

describe('UserListComponent load recovery', () => {
  let queryClient: QueryClient;

  beforeEach(async () => {
    canAssignRoles.set(false);
    findRoles.mockReset();
    findRoles.mockResolvedValue([]);
    findUsers.mockReset();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          gcTime: 0,
          retry: false,
        },
      },
    });

    await TestBed.configureTestingModule({
      imports: [UserListComponent],
      providers: [
        provideRouter([]),
        provideTanStackQuery(queryClient),
        {
          provide: UserListOperations,
          useValue: {
            assignRoles: () => ({
              mutationFn: async () => true,
              mutationKey: ['assign-roles'],
            }),
            findRoles: () => ({
              queryFn: findRoles,
              queryKey: ['roles'],
            }),
            findUsers: (filter: object) => ({
              queryFn: findUsers,
              queryKey: ['users', filter],
            }),
            usersFilter: () => ({ queryKey: ['users'] }),
          },
        },
        {
          provide: PermissionsService,
          useValue: {
            hasPermission: () => canAssignRoles.asReadonly(),
          },
        },
        {
          provide: NotificationService,
          useValue: {
            showError: vi.fn(),
            showSuccess: vi.fn(),
          },
        },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    queryClient.clear();
    vi.clearAllMocks();
    TestBed.resetTestingModule();
  });

  it('announces a failed first load and retries the users query', async () => {
    findUsers
      .mockRejectedValueOnce(new Error('Users unavailable'))
      .mockResolvedValue({
        users: [
          {
            email: 'alex@example.org',
            firstName: 'Alex',
            id: 'user-1',
            lastName: 'Morgan',
            roleIds: [],
            roles: [],
          },
        ],
        usersCount: 1,
      });

    const fixture = TestBed.createComponent(UserListComponent);
    fixture.detectChanges();

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(normalizeText(fixture)).toContain('Users could not be loaded');
    });

    const alert: HTMLElement | null =
      fixture.nativeElement.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain(
      'The user list is unavailable. Check your connection and try again.',
    );

    const retryButton: HTMLButtonElement | null =
      fixture.nativeElement.querySelector('button');
    expect(retryButton?.textContent?.trim()).toBe('Try again');
    retryButton?.click();

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(normalizeText(fixture)).toContain('alex@example.org');
    });
    expect(findUsers).toHaveBeenCalledTimes(2);
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
  });

  it('keeps users visible and retries role options independently', async () => {
    canAssignRoles.set(true);
    findUsers.mockResolvedValue({
      users: [
        {
          email: 'alex@example.org',
          firstName: 'Alex',
          id: 'user-1',
          lastName: 'Morgan',
          roleIds: [],
          roles: [],
        },
      ],
      usersCount: 1,
    });
    findRoles
      .mockRejectedValueOnce(new Error('Roles unavailable'))
      .mockResolvedValue([
        {
          id: 'role-1',
          name: 'Organizer',
        },
      ]);

    const fixture = TestBed.createComponent(UserListComponent);
    fixture.detectChanges();

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(normalizeText(fixture)).toContain('Roles could not be loaded');
    });
    expect(normalizeText(fixture)).toContain('alex@example.org');

    const alert: HTMLElement | null =
      fixture.nativeElement.querySelector('[role="alert"]');
    const retryButton: HTMLButtonElement | null =
      alert?.querySelector('button') ?? null;
    expect(retryButton).not.toBeNull();
    retryButton?.click();

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(normalizeText(fixture)).not.toContain('Roles could not be loaded');
    });
    expect(findRoles).toHaveBeenCalledTimes(2);
    expect(normalizeText(fixture)).toContain('alex@example.org');
  });
});
