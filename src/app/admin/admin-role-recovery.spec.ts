import type {
  AdminRoleRecord,
  AdminRolesCreateInput,
  AdminRolesUpdateInput,
} from '@shared/rpc-contracts/app-rpcs/admin.rpcs';

import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RpcInternalServerError } from '@shared/errors/rpc-errors';
import { RoleNameAlreadyExistsError } from '@shared/rpc-contracts/app-rpcs/role-write.shared';
import {
  provideTanStackQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { APP_RPC_CLIENT } from '../core/effect-rpc-angular-client';
import { NotificationService } from '../core/notification.service';
import { RoleCreateComponent } from './role-create/role-create.component';
import { RoleEditComponent } from './role-edit/role-edit.component';
import { RoleListComponent } from './role-list/role-list.component';
import { TaxRatesSettingsComponent } from './tax-rates-settings/tax-rates-settings.component';

const savedRole: AdminRoleRecord = {
  defaultOrganizerRole: false,
  defaultUserRole: false,
  description: null,
  displayInHub: false,
  id: 'role-1',
  name: 'Support team',
  permissions: [],
  sortOrder: 0,
};
const findRole = vi.fn<() => Promise<AdminRoleRecord>>();
const findRoles = vi.fn<() => Promise<readonly AdminRoleRecord[]>>();
const listTaxRates = vi.fn<() => Promise<readonly never[]>>();
const createRole =
  vi.fn<(input: AdminRolesCreateInput) => Promise<AdminRoleRecord>>();
const updateRole =
  vi.fn<(input: AdminRolesUpdateInput) => Promise<AdminRoleRecord>>();
const showError = vi.fn<(message: string) => void>();
const queryOptions = <T>(key: string, queryFn: () => Promise<T>) => ({
  queryFn,
  queryKey: [key],
});

const rootOf = (fixture: { nativeElement: unknown }) => {
  if (!(fixture.nativeElement instanceof HTMLElement))
    throw new Error('Expected a rendered component');
  return fixture.nativeElement;
};
const roleNameInput = (root: HTMLElement) => {
  const input = root.querySelector('input[matinput]');
  if (!(input instanceof HTMLInputElement))
    throw new Error('Expected the role name field');
  return input;
};
const saveButton = (root: HTMLElement) => {
  const button = root.querySelector('button[type="submit"]');
  if (!(button instanceof HTMLButtonElement))
    throw new Error('Expected the role save button');
  expect(button.disabled).toBe(false);
  return button;
};

describe('administrator role and tax-rate recovery', () => {
  let queryClient: QueryClient;

  beforeEach(async () => {
    findRole.mockReset().mockResolvedValue(savedRole);
    findRoles.mockReset().mockResolvedValue([savedRole]);
    listTaxRates.mockReset().mockResolvedValue([]);
    createRole.mockReset();
    updateRole.mockReset();
    showError.mockReset();
    queryClient = new QueryClient({
      defaultOptions: {
        mutations: { retry: false },
        queries: { gcTime: 0, retry: false },
      },
    });
    await TestBed.configureTestingModule({
      imports: [
        RoleCreateComponent,
        RoleEditComponent,
        RoleListComponent,
        TaxRatesSettingsComponent,
      ],
      providers: [
        provideRouter([]),
        provideTanStackQuery(queryClient),
        { provide: NotificationService, useValue: { showError } },
        {
          provide: APP_RPC_CLIENT,
          useValue: {
            admin: {
              roles: {
                create: { mutationOptions: () => ({ mutationFn: createRole }) },
                findMany: {
                  queryOptions: () => queryOptions('roles', findRoles),
                },
                findOne: { queryOptions: () => queryOptions('role', findRole) },
                update: { mutationOptions: () => ({ mutationFn: updateRole }) },
              },
              tenant: {
                listImportedTaxRates: {
                  queryOptions: () => queryOptions('tax-rates', listTaxRates),
                },
              },
            },
            queryFilter: () => ({ queryKey: ['role-lists'] }),
          },
        },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    queryClient.clear();
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  it.each(['roles', 'role', 'tax-rates'] as const)(
    'recovers a failed %s read through the rendered retry control',
    async (surface) => {
      const read =
        surface === 'role'
          ? findRole
          : surface === 'roles'
            ? findRoles
            : listTaxRates;
      read.mockRejectedValueOnce(
        new RpcInternalServerError({ message: 'private database failure' }),
      );
      const fixture =
        surface === 'role'
          ? TestBed.createComponent(RoleEditComponent)
          : surface === 'roles'
            ? TestBed.createComponent(RoleListComponent)
            : TestBed.createComponent(TaxRatesSettingsComponent);
      if (surface === 'role')
        fixture.componentRef.setInput('roleId', savedRole.id);
      const root = rootOf(fixture);
      await vi.waitFor(async () => {
        await fixture.whenStable();
        expect(root.querySelector('[role="alert"]')).not.toBeNull();
      });
      expect(root.textContent).not.toContain('private database failure');
      expect(read).toHaveBeenCalledTimes(1);
      const retry = root.querySelector(':scope [role="alert"] button');
      if (!(retry instanceof HTMLButtonElement))
        throw new Error('Expected a retry button');
      expect(retry.disabled).toBe(false);
      retry.click();
      await vi.waitFor(async () => {
        await fixture.whenStable();
        expect(read).toHaveBeenCalledTimes(2);
        expect(root.querySelector('[role="alert"]')).toBeNull();
        if (surface === 'role')
          expect(roleNameInput(root).value).toBe(savedRole.name);
        else
          expect(root.textContent).toContain(
            surface === 'roles' ? savedRole.name : 'No tax rates added',
          );
      });
    },
  );

  it.each(['create', 'edit'] as const)(
    'preserves the %s draft after failed writes and navigates only after a successful retry',
    async (mode) => {
      const write = mode === 'create' ? createRole : updateRole;
      const fixture =
        mode === 'create'
          ? TestBed.createComponent(RoleCreateComponent)
          : TestBed.createComponent(RoleEditComponent);
      if (mode === 'edit')
        fixture.componentRef.setInput('roleId', savedRole.id);
      const navigate = vi
        .spyOn(TestBed.inject(Router), 'navigate')
        .mockResolvedValue(true);
      const root = rootOf(fixture);
      await vi.waitFor(async () => {
        await fixture.whenStable();
        expect(root.querySelector('input[matinput]')).not.toBeNull();
      });
      const input = roleNameInput(root);
      input.value = 'Unsubmitted support role';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await fixture.whenStable();
      const failures = [
        {
          error: new RpcInternalServerError({
            message: 'private write failure',
          }),
          message:
            mode === 'create'
              ? 'The role could not be created. Try again.'
              : 'The role could not be updated. Try again.',
        },
        {
          error: new RoleNameAlreadyExistsError({
            message: 'A role with this name already exists',
            name: 'Unsubmitted support role',
          }),
          message: 'A role with this name already exists',
        },
      ];
      for (const failure of failures) {
        write.mockRejectedValueOnce(failure.error);
        saveButton(root).click();
        await vi.waitFor(async () => {
          await fixture.whenStable();
          expect(showError).toHaveBeenLastCalledWith(failure.message);
        });
        expect(roleNameInput(root).value).toBe('Unsubmitted support role');
        expect(navigate).not.toHaveBeenCalled();
      }
      write.mockResolvedValueOnce({ ...savedRole, name: input.value });
      saveButton(root).click();
      await vi.waitFor(async () => {
        await fixture.whenStable();
        expect(navigate).toHaveBeenCalledWith(['admin', 'roles', savedRole.id]);
      });
      expect(write).toHaveBeenCalledTimes(3);
      for (const [payload] of write.mock.calls) {
        expect(payload).toMatchObject({
          name: 'Unsubmitted support role',
          permissions: [],
        });
        if (mode === 'edit') expect(payload).toHaveProperty('id', savedRole.id);
      }
    },
  );
});
