import { Component, input } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  provideTanStackQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NotificationService } from '../../core/notification.service';
import { PlatformTenantPageHeaderComponent } from './platform-tenant-page-header.component';
import {
  PlatformTenantUsersComponent,
  PlatformTenantUsersOperations,
} from './platform-tenant-users.component';

@Component({
  selector: 'app-platform-tenant-page-header',
  template: '',
})
class PlatformTenantPageHeaderStub {
  readonly tenantId = input.required<string>();
  readonly title = input.required<string>();
}

describe('PlatformTenantUsersComponent role loading', () => {
  const loadRoles = vi.fn();
  let queryClient: QueryClient;

  beforeEach(async () => {
    loadRoles
      .mockReset()
      .mockRejectedValueOnce(new Error('Unavailable'))
      .mockResolvedValue([
        {
          defaultOrganizerRole: false,
          defaultUserRole: true,
          id: 'role-1',
          name: 'Member',
        },
      ]);
    queryClient = new QueryClient({
      defaultOptions: {
        mutations: { retry: false },
        queries: { gcTime: 0, retry: false },
      },
    });
    TestBed.overrideComponent(PlatformTenantUsersComponent, {
      add: { imports: [PlatformTenantPageHeaderStub] },
      remove: { imports: [PlatformTenantPageHeaderComponent] },
    });
    await TestBed.configureTestingModule({
      imports: [PlatformTenantUsersComponent],
      providers: [
        provideTanStackQuery(queryClient),
        {
          provide: NotificationService,
          useValue: { showError: vi.fn(), showSuccess: vi.fn() },
        },
        {
          provide: PlatformTenantUsersOperations,
          useValue: {
            assignRoles: () => ({
              mutationFn: vi.fn(),
              mutationKey: ['platform-tenant-users', 'assign-roles'],
            }),
            listRoles: () => ({
              queryFn: loadRoles,
              queryKey: ['platform-tenant-users', 'roles'],
            }),
            listUsers: () => ({
              queryFn: async () => ({
                users: [
                  {
                    email: 'alex@example.test',
                    firstName: 'Alex',
                    id: 'user-1',
                    lastName: 'Able',
                    roleIds: ['role-1'],
                    roles: ['Member'],
                  },
                ],
                usersCount: 1,
              }),
              queryKey: ['platform-tenant-users', 'users'],
            }),
            usersFilter: () => ({
              queryKey: ['platform-tenant-users', 'users'],
            }),
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

  const render = (): ComponentFixture<PlatformTenantUsersComponent> => {
    const fixture = TestBed.createComponent(PlatformTenantUsersComponent);
    fixture.componentRef.setInput('tenantId', 'tenant-1');
    return fixture;
  };

  it('explains role-load failure and enables assignment only after retry', async () => {
    const fixture = render();

    await vi.waitFor(async () => {
      await fixture.whenStable();
      expect(fixture.nativeElement.textContent).toContain(
        'Organization roles could not be loaded.',
      );
    });

    const manageRoles = [
      ...fixture.nativeElement.querySelectorAll('button'),
    ].find(
      (button: HTMLButtonElement) =>
        button.textContent?.trim() === 'Manage roles',
    );
    if (!manageRoles) throw new Error('Expected the role assignment action');
    expect(manageRoles.disabled).toBe(true);

    const retry = [...fixture.nativeElement.querySelectorAll('button')].find(
      (button: HTMLButtonElement) => button.textContent?.trim() === 'Try again',
    );
    if (!retry) throw new Error('Expected the roles retry action');
    retry.click();

    await vi.waitFor(async () => {
      await fixture.whenStable();
      expect(loadRoles).toHaveBeenCalledTimes(2);
      expect(manageRoles.disabled).toBe(false);
    });

    manageRoles.click();
    await fixture.whenStable();
    const reason = (
      fixture.nativeElement as HTMLElement
    ).querySelector<HTMLTextAreaElement>('textarea');
    if (!reason) throw new Error('Expected the assignment reason');
    reason.value = 'Correct the organization assignment';
    reason.dispatchEvent(new Event('input'));
    await fixture.whenStable();

    const save = [...fixture.nativeElement.querySelectorAll('button')].find(
      (button: HTMLButtonElement) =>
        button.textContent?.trim() === 'Save roles',
    );
    if (!save) throw new Error('Expected the save action');
    expect(save.disabled).toBe(false);
  });
});
