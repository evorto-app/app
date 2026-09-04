import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  RpcForbiddenError,
  RpcInternalServerError,
} from '@shared/errors/rpc-errors';
import { AdminRoleNotFoundError } from '@shared/rpc-contracts/app-rpcs/admin.errors';
import {
  provideTanStackQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type TenantRolePermission } from '../../../shared/permissions/permissions';
import { type AdminRoleRecord } from '../../../shared/rpc-contracts/app-rpcs/admin.rpcs';
import { APP_RPC_CLIENT, AppRpc } from '../../core/effect-rpc-angular-client';
import { RoleDetailsComponent } from './role-details.component';

type FindRoleOptions = ReturnType<
  typeof AppRpc.injectClient
>['admin']['roles']['findOne']['queryOptions'];
const findRole = vi.fn<() => Promise<AdminRoleRecord>>();
const queryOptions = (
  input: Parameters<FindRoleOptions>[0],
): ReturnType<FindRoleOptions> => ({
  queryFn: findRole,
  queryKey: [['admin', 'roles', 'findOne'], { input, type: 'query' }],
});

describe('RoleDetailsComponent effective permissions', () => {
  let queryClient: QueryClient;

  beforeEach(async () => {
    findRole.mockReset();
    queryClient = new QueryClient({
      defaultOptions: { queries: { gcTime: 0, retry: false } },
    });
    await TestBed.configureTestingModule({
      imports: [RoleDetailsComponent],
      providers: [
        provideRouter([]),
        provideTanStackQuery(queryClient),
        {
          provide: APP_RPC_CLIENT,
          useValue: { admin: { roles: { findOne: { queryOptions } } } },
        },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    queryClient.clear();
    TestBed.resetTestingModule();
  });

  it.each<{ permissions: TenantRolePermission[]; visible: string[] }>([
    {
      permissions: ['admin:*', 'users:*'],
      visible: [
        'Manage roles',
        'Manage tax rates',
        'Assign all member roles (organization admin)',
        'View all members',
      ],
    },
    {
      permissions: ['users:assignRoles'],
      visible: [
        'Assign all member roles (organization admin)',
        'View all members',
      ],
    },
  ])(
    'renders capabilities granted by $permissions',
    async ({ permissions, visible }) => {
      findRole.mockResolvedValue({
        defaultOrganizerRole: false,
        defaultUserRole: false,
        description: null,
        displayInHub: false,
        id: 'role-1',
        name: 'Organization support',
        permissions,
        sortOrder: 0,
      });
      const fixture = TestBed.createComponent(RoleDetailsComponent);
      fixture.componentRef.setInput('roleId', 'role-1');
      fixture.detectChanges();
      await vi.waitFor(() => {
        fixture.detectChanges();
        const element: unknown = fixture.nativeElement;
        if (!(element instanceof HTMLElement)) {
          throw new TypeError(
            'Expected the role details root to be an HTML element',
          );
        }
        const content = element.textContent;
        for (const label of visible) expect(content).toContain(label);
        expect(content).not.toContain('Create events');
      });
      expect(findRole).toHaveBeenCalledTimes(1);
    },
  );
  it.each([
    {
      error: new AdminRoleNotFoundError({ message: 'Role not found' }),
      expected: 'Role not found',
    },
    {
      error: new RpcForbiddenError({
        message: 'private authorization details',
      }),
      expected: "We couldn't load this role.",
    },
    {
      error: new RpcInternalServerError({
        message: 'private database details',
      }),
      expected: "We couldn't load this role.",
    },
    {
      error: new Error('private transport details'),
      expected: "We couldn't load this role.",
    },
  ])(
    'distinguishes a deleted role without exposing unsafe failures: $expected',
    async ({ error, expected }) => {
      findRole.mockRejectedValueOnce(error);
      const fixture = TestBed.createComponent(RoleDetailsComponent);
      fixture.componentRef.setInput('roleId', 'role-1');
      fixture.detectChanges();
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(
          fixture.nativeElement.querySelector(':scope [role="alert"] p')
            ?.textContent,
        ).toBe(expected);
      });
    },
  );
});
