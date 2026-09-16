import { TestBed } from '@angular/core/testing';
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

import { APP_RPC_CLIENT } from '../../core/effect-rpc-angular-client';
import { RoleDetailsComponent } from './role-details.component';

describe('role detail error state', () => {
  const loadRole = vi.fn();
  let queryClient: QueryClient;

  beforeEach(async () => {
    loadRole.mockReset();
    queryClient = new QueryClient({
      defaultOptions: { queries: { gcTime: 0, retry: false } },
    });
    TestBed.overrideComponent(RoleDetailsComponent, {
      set: {
        template: `
      @if (roleQuery.isError()) { <p role="alert">{{ errorMessage(roleQuery.error()) }}</p> }
    `,
      },
    });
    await TestBed.configureTestingModule({
      imports: [RoleDetailsComponent],
      providers: [
        provideTanStackQuery(queryClient),
        {
          provide: APP_RPC_CLIENT,
          useValue: {
            admin: {
              roles: {
                findOne: {
                  queryOptions: () => ({
                    queryFn: loadRole,
                    queryKey: ['role-details'],
                  }),
                },
              },
            },
          },
        },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    queryClient.clear();
    TestBed.resetTestingModule();
  });

  it.each([
    {
      error: new AdminRoleNotFoundError({ message: 'Role not found' }),
      expected: 'Role not found',
    },
    {
      error: new RpcForbiddenError({
        message: 'private authorization details',
      }),
      expected: 'Unknown error',
    },
    {
      error: new RpcInternalServerError({
        message: 'private database details',
      }),
      expected: 'Unknown error',
    },
    {
      error: new Error('private transport details'),
      expected: 'Unknown error',
    },
  ])(
    'distinguishes a deleted role without exposing unsafe failures: $expected',
    async ({ error, expected }) => {
      loadRole.mockRejectedValueOnce(error);
      const fixture = TestBed.createComponent(RoleDetailsComponent);
      fixture.componentRef.setInput('roleId', 'role-1');
      fixture.detectChanges();
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(
          fixture.nativeElement.querySelector('[role="alert"]')?.textContent,
        ).toBe(expected);
      });
    },
  );
});
