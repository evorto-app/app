import type { RoleLookupRecord } from '@shared/rpc-contracts/app-rpcs/roles.rpcs';

import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { apply, form, FormField, submit } from '@angular/forms/signals';
import { MatAutocompleteHarness } from '@angular/material/autocomplete/testing';
import { MatChipGridHarness } from '@angular/material/chips/testing';
import { MatFormFieldHarness } from '@angular/material/form-field/testing';
import { createRpcQueryKey } from '@heddendorp/effect-angular-query';
import { RoleLookupNotFoundError } from '@shared/rpc-contracts/app-rpcs/roles.errors';
import { RolesFindManyInput } from '@shared/rpc-contracts/app-rpcs/roles.rpcs';
import {
  provideTanStackQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { Schema } from 'effect';
import { firstValueFrom, Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { APP_RPC_CLIENT } from '../../../../core/effect-rpc-angular-client';
import {
  RoleSelectComponent,
  RoleSelectQueries,
} from './role-select.component';
import { roleSelectionSchema } from './role-selection.schema';

const role = {
  defaultOrganizerRole: true,
  defaultUserRole: false,
  id: 'role-organizer',
  name: 'Organizer',
};
const financeRole = {
  defaultOrganizerRole: false,
  defaultUserRole: true,
  id: 'role-finance',
  name: 'Finance',
};

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormField, RoleSelectComponent],
  template: `
    <app-role-select [formField]="roleForm.roleIds" />
    <button type="button" [disabled]="roleForm().invalid()">Save</button>
  `,
})
class RoleSelectFormHost {
  readonly model = signal({ roleIds: [role.id] });
  readonly roleForm = form(this.model, (fields) => {
    apply(fields.roleIds, roleSelectionSchema);
  });
}

const resolveRole = async (id: string) => {
  const selected = [role, financeRole].find((candidate) => candidate.id === id);
  if (!selected)
    throw new RoleLookupNotFoundError({ id, message: 'Role not found' });
  return selected;
};

describe('RoleSelectComponent', () => {
  let fixture: ComponentFixture<RoleSelectComponent>;
  const loadRoles = vi.fn(async (search: string) =>
    [role, financeRole].filter((candidate) =>
      candidate.name.toLowerCase().includes(search.toLowerCase()),
    ),
  );
  const loadRole = vi.fn(resolveRole);
  let queryClient: QueryClient;

  beforeEach(async () => {
    loadRoles
      .mockReset()
      .mockImplementation(async (search: string) =>
        [role, financeRole].filter((candidate) =>
          candidate.name.toLowerCase().includes(search.toLowerCase()),
        ),
      );
    loadRole.mockReset().mockImplementation(resolveRole);
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          gcTime: 0,
          retry: false,
        },
      },
    });

    await TestBed.configureTestingModule({
      imports: [RoleSelectComponent, RoleSelectFormHost],
      providers: [
        provideTanStackQuery(queryClient),
        {
          provide: RoleSelectQueries,
          useValue: {
            search: (search: string) => ({
              queryFn: () => loadRoles(search),
              queryKey: ['roles', 'search', search],
            }),
            selected: (id: string) => ({
              queryFn: () => loadRole(id),
              queryKey: ['roles', 'selected', id],
            }),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(RoleSelectComponent);
    fixture.componentRef.setInput('value', [role.id]);
    fixture.detectChanges();
  });

  afterEach(() => {
    queryClient.clear();
    TestBed.resetTestingModule();
  });

  it('names the remove button from the resolved role inside a keyboard-focusable grid', async () => {
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(
        fixture.nativeElement.querySelector(
          'button[aria-label="Remove Organizer"]',
        ),
      ).not.toBeNull();
      expect(
        fixture.nativeElement
          .querySelector('mat-chip-grid')
          ?.getAttribute('aria-label'),
      ).toBe('Selected roles');
    });

    const removeButton: HTMLButtonElement = fixture.nativeElement.querySelector(
      'button[aria-label="Remove Organizer"]',
    );
    expect(removeButton.getAttribute('aria-label')).not.toContain(
      '[object Object]',
    );
    expect(removeButton.type).toBe('button');

    const chipGrid: HTMLElement | null =
      fixture.nativeElement.querySelector('mat-chip-grid');
    expect(chipGrid).not.toBeNull();
    expect(chipGrid?.getAttribute('role')).toBe('grid');
    expect(chipGrid?.getAttribute('aria-label')).toBe('Selected roles');

    const roleInput: HTMLInputElement = fixture.nativeElement.querySelector(
      'input[placeholder="Add role…"]',
    );
    expect(roleInput.tabIndex).toBe(0);
    expect(roleInput.autocomplete).toBe('off');
    expect(fixture.componentInstance.selectionValid()).toBe(true);

    roleInput.focus();
    expect(document.activeElement).toBe(roleInput);
  });

  it('names the grid only while Material exposes grid semantics', async () => {
    fixture.componentRef.setInput('value', []);
    fixture.detectChanges();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(
        fixture.nativeElement.querySelectorAll('mat-chip-row'),
      ).toHaveLength(0);
    });

    const chipGrid: HTMLElement | null =
      fixture.nativeElement.querySelector('mat-chip-grid');
    expect(chipGrid).not.toBeNull();
    expect(chipGrid?.getAttribute('role')).toBeNull();
    expect(chipGrid?.getAttribute('aria-label')).toBeNull();

    const loader = TestbedHarnessEnvironment.loader(fixture);
    const formField = await loader.getHarness(MatFormFieldHarness);
    expect(await formField.getLabel()).toBe('Selected roles');

    const roleInput: HTMLInputElement = fixture.nativeElement.querySelector(
      'input[placeholder="Add role…"]',
    );
    roleInput.value = 'orga';
    roleInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(chipGrid?.getAttribute('role')).toBe('grid');
    expect(chipGrid?.getAttribute('aria-label')).toBe('Selected roles');

    roleInput.value = '';
    roleInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(chipGrid?.getAttribute('role')).toBeNull();
    expect(chipGrid?.getAttribute('aria-label')).toBeNull();
  });

  it.each(['disabled', 'readonly'] as const)(
    'disables chip removal when the control is %s',
    async (state) => {
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(
          fixture.nativeElement.querySelector(
            'button[aria-label="Remove Organizer"]',
          ),
        ).not.toBeNull();
      });

      fixture.componentRef.setInput(state, true);
      fixture.detectChanges();

      const chipGrid: HTMLElement =
        fixture.nativeElement.querySelector('mat-chip-grid');
      const removeButton: HTMLButtonElement =
        fixture.nativeElement.querySelector(
          'button[aria-label="Remove Organizer"]',
        );
      const roleInput: HTMLInputElement = fixture.nativeElement.querySelector(
        'input[placeholder="Add role…"]',
      );

      expect(chipGrid.getAttribute('aria-disabled')).toBe('true');
      expect(removeButton.disabled).toBe(true);
      expect(roleInput.disabled).toBe(true);

      removeButton.click();
      fixture.detectChanges();
      expect(fixture.componentInstance.value()).toEqual([role.id]);
    },
  );

  it('tracks multiple catalog roles uniquely while the value resets', async () => {
    fixture.componentRef.setInput('value', ['role-organizer', 'role-finance']);
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(
        fixture.nativeElement.querySelectorAll('mat-chip-row'),
      ).toHaveLength(2);
    });
    expect(loadRoles).toHaveBeenCalledOnce();
    const warning = vi
      .spyOn(console, 'warn')
      .mockImplementation((...messages) => void messages);

    fixture.componentRef.setInput('value', []);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(
      warning.mock.calls.some((call) =>
        call.some((value) => String(value).includes('NG0955')),
      ),
    ).toBe(false);
    warning.mockRestore();
  });

  it('renders and removes a selected role that is missing from the catalog', async () => {
    fixture.componentRef.setInput('value', ['missing-role']);

    await vi.waitFor(async () => {
      await fixture.whenStable();
      const selectedRole = (fixture.nativeElement as HTMLElement).querySelector(
        'mat-chip-row',
      );
      expect(selectedRole?.textContent).toContain('Unavailable role');
      expect(selectedRole?.textContent).toContain('(no longer available)');
      expect(fixture.nativeElement.textContent).toContain(
        '1 selected role no longer exists',
      );
      expect(fixture.componentInstance.selectionValid()).toBe(false);
    });

    const removeButton = (
      fixture.nativeElement as HTMLElement
    ).querySelector<HTMLButtonElement>(
      'button[aria-label="Remove Unavailable role (missing-role)"]',
    );
    if (!removeButton) throw new Error('Expected the unavailable-role action');
    removeButton.click();
    await fixture.whenStable();

    expect(fixture.componentInstance.value()).toEqual([]);
    expect(fixture.componentInstance.selectionValid()).toBe(true);
  });

  it('preserves resolved selected chips when role search fails and retries the search', async () => {
    loadRoles
      .mockRejectedValueOnce(new Error('Role provider unavailable'))
      .mockResolvedValue([role, financeRole]);

    await queryClient.resetQueries({ queryKey: ['roles', 'search'] });

    await vi.waitFor(async () => {
      await fixture.whenStable();
      expect(fixture.nativeElement.textContent).toContain(
        'Role search could not be loaded.',
      );
      expect(
        (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
          'input[placeholder="Add role…"]',
        )?.disabled,
      ).toBe(false);
    });
    expect(fixture.nativeElement.querySelectorAll('mat-chip-row')).toHaveLength(
      1,
    );
    expect(fixture.componentInstance.value()).toEqual([role.id]);
    expect(fixture.componentInstance.selectionValid()).toBe(true);

    const retry = [
      ...(
        fixture.nativeElement as HTMLElement
      ).querySelectorAll<HTMLButtonElement>('button'),
    ].find((button) => button.textContent?.trim() === 'Try again');
    if (!retry) throw new Error('Expected a role-catalog retry button');
    retry.click();

    await vi.waitFor(async () => {
      await fixture.whenStable();
      expect(fixture.nativeElement.textContent).not.toContain(
        'Role search could not be loaded.',
      );
      expect(
        fixture.nativeElement.querySelector(
          'button[aria-label="Remove Organizer"]',
        ),
      ).not.toBeNull();
    });
  });

  it('removes a selected role through the chip keyboard action', async () => {
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(
        fixture.nativeElement.querySelector('mat-chip-row'),
      ).not.toBeNull();
    });

    const loader = TestbedHarnessEnvironment.loader(fixture);
    const chipGrid = await loader.getHarness(MatChipGridHarness);
    const selectedRoles = await chipGrid.getRows();
    const selectedRole = selectedRoles[0];
    if (!selectedRole) {
      throw new Error('Expected the selected role chip to be rendered');
    }

    await selectedRole.remove();

    expect(fixture.componentInstance.value()).toEqual([]);
    expect(fixture.componentInstance.touched()).toBe(true);
  });

  it('preserves unverified IDs as removable chips and resolves them after retry', async () => {
    loadRole.mockRejectedValueOnce(new Error('Lookup unavailable'));
    await queryClient.resetQueries({ queryKey: ['roles', 'selected'] });

    await vi.waitFor(async () => {
      await fixture.whenStable();
      expect(fixture.nativeElement.textContent).toContain(
        'Selected roles could not be verified.',
      );
      expect(fixture.nativeElement.textContent).toContain(
        'Role role-organizer',
      );
      expect(fixture.nativeElement.textContent).not.toContain(
        'no longer exists',
      );
      expect(
        fixture.nativeElement.querySelector(
          'button[aria-label="Remove Role role-organizer"]',
        ),
      ).not.toBeNull();
      expect(fixture.componentInstance.selectionValid()).toBe(false);
    });
    expect(fixture.componentInstance.value()).toEqual([role.id]);

    await fixture.componentInstance.retry();
    await vi.waitFor(async () => {
      await fixture.whenStable();
      expect(
        fixture.nativeElement.querySelector(
          'button[aria-label="Remove Organizer"]',
        ),
      ).not.toBeNull();
      expect(fixture.componentInstance.selectionValid()).toBe(true);
    });

    loadRole.mockRejectedValueOnce(new Error('Lookup unavailable'));
    await queryClient.resetQueries({ queryKey: ['roles', 'selected'] });
    await vi.waitFor(async () => {
      await fixture.whenStable();
      expect(
        fixture.nativeElement.querySelector(
          'button[aria-label="Remove Role role-organizer"]',
        ),
      ).not.toBeNull();
    });
    const remove = (
      fixture.nativeElement as HTMLElement
    ).querySelector<HTMLButtonElement>(
      'button[aria-label="Remove Role role-organizer"]',
    );
    if (!remove) throw new Error('Expected unverified selection removal');
    remove.click();
    await fixture.whenStable();
    expect(fixture.componentInstance.value()).toEqual([]);
    expect(fixture.componentInstance.selectionValid()).toBe(true);
  });

  it('sends debounced server search and resolves selections outside the bounded results', async () => {
    loadRoles.mockResolvedValue([financeRole]);
    await queryClient.resetQueries({ queryKey: ['roles', 'search'] });
    await vi.waitFor(async () => {
      await fixture.whenStable();
      expect(
        fixture.nativeElement.querySelector(
          'button[aria-label="Remove Organizer"]',
        ),
      ).not.toBeNull();
      expect(fixture.componentInstance.selectionValid()).toBe(true);
    });
    expect(loadRole).toHaveBeenCalledWith(role.id);
    expect(loadRoles).toHaveBeenCalledWith('');
    loadRoles.mockClear();
    const input = (
      fixture.nativeElement as HTMLElement
    ).querySelector<HTMLInputElement>('input[placeholder="Add role…"]');
    if (!input) throw new Error('Expected role search input');
    input.value = 'fin';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(loadRoles).not.toHaveBeenCalled();
    input.value = 'finance';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(loadRoles).toHaveBeenCalledExactlyOnceWith('finance');
    });
    expect(fixture.componentInstance.value()).toEqual([role.id]);
    expect(fixture.nativeElement.textContent).not.toContain('no longer exists');
  });

  it('limits the native role input to the RPC search maximum', () => {
    const input: HTMLInputElement =
      fixture.nativeElement.querySelector('input');
    expect(input.maxLength).toBe(64);
  });

  it('does not dispatch oversized searches and resumes after the input is corrected', async () => {
    await fixture.whenStable();
    const input: HTMLInputElement =
      fixture.nativeElement.querySelector('input');
    loadRoles.mockClear();
    input.value = 'x'.repeat(65);
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 350));
    await fixture.whenStable();
    expect(loadRoles).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelectorAll('mat-option')).toHaveLength(
      0,
    );
    input.value = 'finance';
    input.dispatchEvent(new Event('input'));
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(loadRoles).toHaveBeenCalledExactlyOnceWith('finance');
    });
  });

  it('adds the clicked autocomplete result after Material writes its option value', async () => {
    const loader = TestbedHarnessEnvironment.loader(fixture);
    const autocomplete = await loader.getHarness(MatAutocompleteHarness);
    await autocomplete.enterText('fin');
    await vi.waitFor(() => {
      expect(loadRoles).toHaveBeenCalledWith('fin');
    });

    await autocomplete.selectOption({ text: financeRole.name });

    await vi.waitFor(async () => {
      await fixture.whenStable();
      expect(fixture.componentInstance.value()).toEqual([
        role.id,
        financeRole.id,
      ]);
      expect(
        fixture.nativeElement.querySelector(
          'button[aria-label="Remove Finance"]',
        ),
      ).not.toBeNull();
      expect(fixture.componentInstance.selectionValid()).toBe(true);
    });
    expect(await autocomplete.getValue()).toBe('');
  });

  it('does not add the previous sole result when Enter arrives before the next search commits', async () => {
    await vi.waitFor(async () => {
      await fixture.whenStable();
      expect(fixture.componentInstance.selectionValid()).toBe(true);
      expect(loadRoles).toHaveBeenCalledWith('');
    });
    const input = (
      fixture.nativeElement as HTMLElement
    ).querySelector<HTMLInputElement>('input[placeholder="Add role…"]');
    if (!input) throw new Error('Expected role search input');
    input.value = 'No matching role';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    input.dispatchEvent(
      new KeyboardEvent('keydown', {
        bubbles: true,
        key: 'Enter',
        keyCode: 13,
      }),
    );
    fixture.detectChanges();
    expect(fixture.componentInstance.value()).toEqual([role.id]);
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(loadRoles).toHaveBeenCalledWith('No matching role');
    });
    expect(fixture.componentInstance.value()).toEqual([role.id]);
  });

  it('blocks parent submission while selected roles are pending and preserves validation on reset', async () => {
    fixture.destroy();
    queryClient.clear();
    const resolution = new Subject<RoleLookupRecord>();
    loadRole.mockReturnValueOnce(firstValueFrom(resolution));
    const host = TestBed.createComponent(RoleSelectFormHost);
    host.detectChanges();
    await vi.waitFor(() => {
      host.detectChanges();
      expect(loadRole).toHaveBeenCalledWith(role.id);
      expect(host.componentInstance.roleForm().invalid()).toBe(true);
    });
    const action = vi.fn(() => Promise.resolve());
    await submit(host.componentInstance.roleForm, action);
    expect(action).not.toHaveBeenCalled();
    host.componentInstance.roleForm().reset();
    expect(host.componentInstance.roleForm().invalid()).toBe(true);
    resolution.next(role);
    await vi.waitFor(() => {
      host.detectChanges();
      expect(host.componentInstance.roleForm().valid()).toBe(true);
    });
    await submit(host.componentInstance.roleForm, action);
    expect(action).toHaveBeenCalledOnce();
  });

  it.each([
    [
      'missing',
      new RoleLookupNotFoundError({
        id: 'missing-role',
        message: 'Role not found',
      }),
      'roleMissing',
    ],
    ['unverified', new Error('Lookup unavailable'), 'roleUnverified'],
  ])(
    'blocks parent submission for %s selections until removal',
    async (_state, error, kind) => {
      fixture.destroy();
      queryClient.clear();
      loadRole.mockRejectedValue(error);
      const host = TestBed.createComponent(RoleSelectFormHost);
      host.componentInstance.model.set({ roleIds: ['missing-role'] });
      host.detectChanges();
      await vi.waitFor(() => {
        host.detectChanges();
        expect(
          host.componentInstance.roleForm
            .roleIds()
            .errors()
            .map((error) => error.kind),
        ).toContain(kind);
      });
      const action = vi.fn(() => Promise.resolve());
      await submit(host.componentInstance.roleForm, action);
      expect(action).not.toHaveBeenCalled();
      const remove = (
        host.nativeElement as HTMLElement
      ).querySelector<HTMLButtonElement>('button[matChipRemove]');
      if (!remove) throw new Error('Expected selected role removal');
      remove.click();
      await vi.waitFor(() => {
        host.detectChanges();
        expect(host.componentInstance.roleForm().valid()).toBe(true);
      });
      await submit(host.componentInstance.roleForm, action);
      expect(action).toHaveBeenCalledOnce();
    },
  );

  it('immediately invalidates an external ID replacement instead of trusting the previous selection', async () => {
    fixture.destroy();
    queryClient.clear();
    const host = TestBed.createComponent(RoleSelectFormHost);
    host.detectChanges();
    await vi.waitFor(() => {
      host.detectChanges();
      expect(host.componentInstance.roleForm().valid()).toBe(true);
    });
    host.componentInstance.model.set({ roleIds: ['missing-role'] });
    expect(host.componentInstance.roleForm().invalid()).toBe(true);
    const action = vi.fn(() => Promise.resolve());
    await submit(host.componentInstance.roleForm, action);
    expect(action).not.toHaveBeenCalled();
    await vi.waitFor(() => {
      host.detectChanges();
      expect(
        host.componentInstance.roleForm
          .roleIds()
          .errors()
          .map((error) => error.kind),
      ).toContain('roleMissing');
    });
  });
});

describe('role lookup search boundary', () => {
  it('accepts 64 characters and rejects longer RPC searches', () => {
    expect(Schema.is(RolesFindManyInput)({ search: 'x'.repeat(64) })).toBe(
      true,
    );
    expect(Schema.is(RolesFindManyInput)({ search: 'x'.repeat(65) })).toBe(
      false,
    );
    expect(Schema.is(RolesFindManyInput)({ defaultUserRole: true })).toBe(true);
  });
});

describe('RoleSelectQueries cached role verification', () => {
  const loadRole = vi.fn(resolveRole);
  let queryClient: QueryClient;
  let queries: RoleSelectQueries;
  const keyFor = (input: RolesFindManyInput, prefix = 'rpc') =>
    createRpcQueryKey(['roles', 'findMany'], {
      input,
      keyPrefix: prefix,
      type: 'query',
    });

  beforeEach(async () => {
    loadRole.mockReset().mockImplementation(resolveRole);
    queryClient = new QueryClient({
      defaultOptions: { queries: { gcTime: 0, retry: false } },
    });
    await TestBed.configureTestingModule({
      imports: [RoleSelectComponent, RoleSelectFormHost],
      providers: [
        provideTanStackQuery(queryClient),
        {
          provide: APP_RPC_CLIENT,
          useValue: {
            roles: {
              findMany: {
                queryOptions: (input: RolesFindManyInput) => ({
                  queryFn: async () => [role, financeRole],
                  queryKey: keyFor(input),
                }),
              },
              findOne: {
                queryOptions: ({ id }: { id: string }) => ({
                  queryFn: () => loadRole(id),
                  queryKey: createRpcQueryKey(['roles', 'findOne'], {
                    input: { id },
                    keyPrefix: 'rpc',
                    type: 'query',
                  }),
                }),
              },
            },
          },
        },
      ],
    }).compileComponents();
    queries = TestBed.inject(RoleSelectQueries);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    queryClient.clear();
  });

  it('verifies many default selections from an existing lookup without per-role requests', async () => {
    const defaults = Array.from({ length: 60 }, (_, index) => ({
      ...role,
      id: `default-${index}`,
      name: `Default ${index}`,
    }));
    const updatedAt = Date.now() - 1000;
    queryClient.setQueryData(keyFor({ defaultOrganizerRole: true }), defaults, {
      updatedAt,
    });
    const host = TestBed.createComponent(RoleSelectFormHost);
    host.componentInstance.model.set({ roleIds: defaults.map(({ id }) => id) });
    host.detectChanges();
    await host.whenStable();
    expect(loadRole).not.toHaveBeenCalled();
    expect(host.componentInstance.roleForm().valid()).toBe(true);
    expect(host.nativeElement.querySelectorAll('mat-chip-row')).toHaveLength(
      60,
    );
    expect(host.nativeElement.textContent).toContain('Default 59');
    for (const { id } of defaults) {
      expect(
        queryClient.getQueryState(queries.selected(id).queryKey)?.dataUpdatedAt,
      ).toBe(updatedAt);
    }
  });

  it('uses the newest successful lookup while retaining its original freshness timestamp', async () => {
    const updatedAt = Date.now() - 1000;
    queryClient.setQueryData(
      keyFor({ search: '' }),
      [{ ...role, name: 'Older name' }],
      { updatedAt: updatedAt - 1000 },
    );
    queryClient.setQueryData(keyFor({ defaultOrganizerRole: true }), [role], {
      updatedAt,
    });
    expect(await queryClient.fetchQuery(queries.selected(role.id))).toEqual(
      role,
    );
    expect(loadRole).not.toHaveBeenCalled();
    expect(
      queryClient.getQueryState(queries.selected(role.id).queryKey)
        ?.dataUpdatedAt,
    ).toBe(updatedAt);
  });

  it.each([
    'stale',
    'invalidated',
    'failed',
    'incomplete',
    'malformed',
    'overbroad',
    'other-rpc-scope',
    'other-procedure',
  ] as const)(
    'does not confirm selected roles from a %s lookup',
    async (state) => {
      const lookupKey =
        state === 'other-procedure'
          ? createRpcQueryKey(['roles', 'findMany', 'other'], {
              input: {},
              keyPrefix: 'rpc',
              type: 'query',
            })
          : keyFor(
              { defaultOrganizerRole: true },
              state === 'other-rpc-scope' ? 'other-app' : 'rpc',
            );
      queryClient.setQueryData(
        lookupKey,
        state === 'malformed'
          ? [{ id: role.id, name: role.name }]
          : state === 'overbroad'
            ? [{ ...role, permissions: ['admin:manageRoles'] }]
            : [role],
        { updatedAt: Date.now() - (state === 'stale' ? 31_000 : 1000) },
      );
      const lookup = queryClient
        .getQueryCache()
        .find({ exact: true, queryKey: lookupKey });
      switch (state) {
        case 'failed': {
          lookup?.setState({
            error: new Error('Lookup failed'),
            status: 'error',
          });
          break;
        }
        case 'incomplete': {
          {
            lookup?.setState({ fetchStatus: 'fetching' });
            // No default
          }
          break;
        }
        case 'invalidated': {
          lookup?.invalidate();
          break;
        }
      }
      const resolution = new Subject<RoleLookupRecord>();
      loadRole.mockReturnValueOnce(firstValueFrom(resolution));
      const host = TestBed.createComponent(RoleSelectFormHost);
      host.detectChanges();
      await vi.waitFor(() =>
        expect(loadRole).toHaveBeenCalledExactlyOnceWith(role.id),
      );
      expect(host.componentInstance.roleForm().invalid()).toBe(true);
      resolution.next(role);
      await vi.waitFor(() => {
        host.detectChanges();
        expect(host.componentInstance.roleForm().valid()).toBe(true);
      });
    },
  );

  it('revalidates a hydrated selection after invalidation and preserves missing-role recovery', async () => {
    queryClient.setQueryData(keyFor({ defaultOrganizerRole: true }), [role]);
    const host = TestBed.createComponent(RoleSelectFormHost);
    host.detectChanges();
    await host.whenStable();
    expect(host.componentInstance.roleForm().valid()).toBe(true);
    expect(loadRole).not.toHaveBeenCalled();

    loadRole.mockRejectedValueOnce(
      new RoleLookupNotFoundError({ id: role.id, message: 'Role not found' }),
    );
    await queryClient.invalidateQueries({
      exact: true,
      queryKey: queries.selected(role.id).queryKey,
    });
    await vi.waitFor(() => {
      host.detectChanges();
      expect(
        host.componentInstance.roleForm
          .roleIds()
          .errors()
          .map(({ kind }) => kind),
      ).toContain('roleMissing');
    });
    expect(loadRole).toHaveBeenCalledExactlyOnceWith(role.id);
    expect(host.nativeElement.textContent).toContain(
      'selected role no longer exists',
    );
    const remove: HTMLButtonElement = host.nativeElement.querySelector(
      'button[matChipRemove]',
    );
    remove.click();
    await vi.waitFor(() => {
      host.detectChanges();
      expect(host.componentInstance.roleForm().valid()).toBe(true);
    });
  });

  it.each([
    [
      'missing',
      new RoleLookupNotFoundError({
        id: 'missing-role',
        message: 'Role not found',
      }),
      'roleMissing',
    ],
    ['unknown', new Error('Lookup unavailable'), 'roleUnverified'],
  ] as const)(
    'keeps uncached %s selections invalid and removable',
    async (_name, failure, kind) => {
      queryClient.setQueryData(keyFor({ defaultOrganizerRole: true }), [role]);
      loadRole.mockRejectedValue(failure);
      const host = TestBed.createComponent(RoleSelectFormHost);
      host.componentInstance.model.set({ roleIds: ['missing-role'] });
      host.detectChanges();
      await vi.waitFor(() => {
        host.detectChanges();
        expect(
          host.componentInstance.roleForm
            .roleIds()
            .errors()
            .map(({ kind }) => kind),
        ).toContain(kind);
      });
      const remove: HTMLButtonElement = host.nativeElement.querySelector(
        'button[matChipRemove]',
      );
      remove.click();
      await vi.waitFor(() => {
        host.detectChanges();
        expect(host.componentInstance.roleForm().valid()).toBe(true);
      });
    },
  );
});
