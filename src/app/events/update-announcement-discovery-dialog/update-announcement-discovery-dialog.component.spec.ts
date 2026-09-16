import '@angular/compiler';
import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { RoleLookupNotFoundError } from '@shared/rpc-contracts/app-rpcs/roles.errors';
import {
  provideTanStackQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RoleSelectQueries } from '../../shared/components/controls/role-select/role-select.component';
import { UpdateAnnouncementDiscoveryDialogComponent } from './update-announcement-discovery-dialog.component';

const role = {
  defaultOrganizerRole: true,
  defaultUserRole: false,
  id: 'role-organizer',
  name: 'Organizer',
};

const saveButton = (root: HTMLElement): HTMLButtonElement => {
  const button = [...root.querySelectorAll<HTMLButtonElement>('button')].find(
    (candidate) => candidate.textContent?.trim() === 'Save',
  );
  if (!button) throw new Error('Expected save button');
  return button;
};

describe('UpdateAnnouncementDiscoveryDialogComponent', () => {
  const close = vi.fn();
  const loadRoles = vi.fn(async () => [role]);
  const loadRole = vi.fn(async (id: string) => {
    if (id !== role.id)
      throw new RoleLookupNotFoundError({ id, message: 'Role not found' });
    return role;
  });
  let queryClient: QueryClient;

  beforeEach(async () => {
    close.mockReset();
    loadRoles.mockReset().mockResolvedValue([role]);
    loadRole.mockReset().mockImplementation(async (id: string) => {
      if (id !== role.id)
        throw new RoleLookupNotFoundError({ id, message: 'Role not found' });
      return role;
    });
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { gcTime: 0, retry: false },
      },
    });

    await TestBed.configureTestingModule({
      imports: [UpdateAnnouncementDiscoveryDialogComponent],
      providers: [
        provideNoopAnimations(),
        provideTanStackQuery(queryClient),
        {
          provide: MAT_DIALOG_DATA,
          useValue: {
            event: {
              announcementRoleIds: [],
              title: 'Welcome week',
            },
          },
        },
        {
          provide: MatDialogRef,
          useValue: { close },
        },
        {
          provide: RoleSelectQueries,
          useValue: {
            search: (
              search: string,
            ): ReturnType<RoleSelectQueries['search']> => ({
              queryFn: async () => {
                const loadedRoles = await loadRoles();
                return loadedRoles
                  .filter((role) =>
                    role.name.toLowerCase().includes(search.toLowerCase()),
                  )
                  .slice(0, 15);
              },
              queryKey: [
                ['roles', 'findMany'],
                { input: { search }, type: 'query' },
              ],
            }),
            selected: (
              id: string,
            ): ReturnType<RoleSelectQueries['selected']> => ({
              queryFn: () => loadRole(id),
              queryKey: [
                ['roles', 'findOne'],
                { input: { id }, type: 'query' },
              ],
              retry: false,
              staleTime: 30_000,
            }),
          } satisfies Pick<RoleSelectQueries, 'search' | 'selected'>,
        },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    queryClient.clear();
    TestBed.resetTestingModule();
  });

  it('saves an empty selection as link-only after roles load', async () => {
    const fixture = TestBed.createComponent(
      UpdateAnnouncementDiscoveryDialogComponent,
    );
    const root: unknown = fixture.nativeElement;
    if (!(root instanceof HTMLElement)) {
      throw new TypeError('Expected the announcement dialog element');
    }

    await vi.waitFor(async () => {
      await fixture.whenStable();
      expect(saveButton(root).disabled).toBe(false);
    });

    expect(root.textContent?.replaceAll(/\s+/g, ' ')).toContain(
      'Without a selected role, this announcement is available only through its direct link.',
    );
    expect(root.textContent?.replaceAll(/\s+/g, ' ')).toContain(
      'Selecting roles only changes whether it appears in Events. It does not give anyone a role or send a message.',
    );
    saveButton(root).click();

    expect(close).toHaveBeenCalledWith({ announcementRoleIds: [] });
  });

  it('does not allow saving when a selected role cannot be verified', async () => {
    loadRole.mockRejectedValue(new Error('Unavailable'));
    TestBed.overrideProvider(MAT_DIALOG_DATA, {
      useValue: {
        event: { announcementRoleIds: [role.id], title: 'Welcome week' },
      },
    });
    const fixture = TestBed.createComponent(
      UpdateAnnouncementDiscoveryDialogComponent,
    );
    const root: unknown = fixture.nativeElement;
    if (!(root instanceof HTMLElement)) {
      throw new TypeError('Expected the announcement dialog element');
    }

    await vi.waitFor(async () => {
      await fixture.whenStable();
      expect(root.textContent).toContain(
        'Selected roles could not be verified.',
      );
    });

    expect(loadRole).toHaveBeenCalledWith(role.id);
    expect(
      root.querySelector('button[aria-label="Remove Role role-organizer"]'),
    ).not.toBeNull();
    expect(saveButton(root).disabled).toBe(true);
    saveButton(root).click();
    expect(close).not.toHaveBeenCalled();
  });
});
