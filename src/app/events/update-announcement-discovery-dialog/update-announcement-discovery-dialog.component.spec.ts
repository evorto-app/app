import '@angular/compiler';
import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import {
  provideTanStackQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RoleSelectQueries } from '../../shared/components/controls/role-select/role-select.component';
import { UpdateAnnouncementDiscoveryDialogComponent } from './update-announcement-discovery-dialog.component';

const organizerRole = {
  defaultOrganizerRole: true,
  defaultUserRole: false,
  id: 'role-organizer',
  name: 'Organizer',
};

const buttonByText = (
  root: HTMLElement,
  label: string,
): HTMLButtonElement | undefined =>
  [...root.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent?.trim() === label,
  );

describe('UpdateAnnouncementDiscoveryDialogComponent', () => {
  const close = vi.fn();
  const loadRoles = vi.fn(async () => [organizerRole]);
  let dialogData: {
    event: {
      announcementRoleIds: string[];
      title: string;
    };
  };
  let queryClient: QueryClient;

  beforeEach(async () => {
    close.mockReset();
    loadRoles.mockReset().mockResolvedValue([organizerRole]);
    dialogData = {
      event: {
        announcementRoleIds: [],
        title: 'Welcome week',
      },
    };
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          gcTime: 0,
          retry: false,
        },
      },
    });

    await TestBed.configureTestingModule({
      imports: [UpdateAnnouncementDiscoveryDialogComponent],
      providers: [
        provideNoopAnimations(),
        provideTanStackQuery(queryClient),
        {
          provide: MAT_DIALOG_DATA,
          useFactory: () => dialogData,
        },
        {
          provide: MatDialogRef,
          useValue: { close },
        },
        {
          provide: RoleSelectQueries,
          useValue: {
            catalog: () => ({
              queryFn: loadRoles,
              queryKey: ['roles', 'catalog'],
            }),
          },
        },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    queryClient.clear();
    TestBed.resetTestingModule();
  });

  it('shows announcement discovery semantics without an ordinary audience control', async () => {
    const fixture = TestBed.createComponent(
      UpdateAnnouncementDiscoveryDialogComponent,
    );
    await fixture.whenStable();
    const text = (fixture.nativeElement as HTMLElement).textContent
      ?.replaceAll(/\s+/g, ' ')
      .trim();

    expect(text).toContain('Choose who can find Welcome week');
    expect(text).toContain(
      'Select the organization roles that should see this announcement in Events',
    );
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('mat-select'),
    ).toBeNull();
  });

  it('saves a successfully loaded empty role selection as link-only discovery', async () => {
    const fixture = TestBed.createComponent(
      UpdateAnnouncementDiscoveryDialogComponent,
    );
    const root = fixture.nativeElement as HTMLElement;

    await vi.waitFor(async () => {
      await fixture.whenStable();
      expect(buttonByText(root, 'Save')?.disabled).toBe(false);
    });

    const text = root.textContent?.replaceAll(/\s+/g, ' ').trim();
    expect(text).toContain(
      'Without a selected role, this announcement is available only through its direct link',
    );
    expect(text).toContain(
      "Selecting roles does not change anyone's access or send them a message",
    );

    fixture.componentInstance.save();

    expect(close).toHaveBeenCalledWith({
      announcementRoleIds: [],
    });
  });

  it('keeps save disabled and guards the action while the role catalog is loading', async () => {
    let resolveRoles: ((roles: [typeof organizerRole]) => void) | undefined;
    // Angular's browser library target does not expose Promise.withResolvers.
    // eslint-disable-next-line unicorn/prefer-promise-with-resolvers
    const roles = new Promise<[typeof organizerRole]>((resolve) => {
      resolveRoles = resolve;
    });
    loadRoles.mockReturnValue(roles);
    dialogData.event.announcementRoleIds = [organizerRole.id];
    const fixture = TestBed.createComponent(
      UpdateAnnouncementDiscoveryDialogComponent,
    );
    const root = fixture.nativeElement as HTMLElement;

    await fixture.whenStable();

    expect(buttonByText(root, 'Save')?.disabled).toBe(true);
    fixture.componentInstance.save();
    expect(close).not.toHaveBeenCalled();

    resolveRoles?.([organizerRole]);
    await vi.waitFor(async () => {
      await fixture.whenStable();
      expect(buttonByText(root, 'Save')?.disabled).toBe(false);
    });
  });

  it('requires deleted role selections to be removed before saving', async () => {
    dialogData.event.announcementRoleIds = ['role-deleted'];
    const fixture = TestBed.createComponent(
      UpdateAnnouncementDiscoveryDialogComponent,
    );
    const root = fixture.nativeElement as HTMLElement;

    await vi.waitFor(async () => {
      await fixture.whenStable();
      expect(root.textContent).toContain('1 selected role no longer exists');
    });

    expect(buttonByText(root, 'Save')?.disabled).toBe(true);
    fixture.componentInstance.save();
    expect(close).not.toHaveBeenCalled();

    const remove = root.querySelector<HTMLButtonElement>(
      'button[aria-label="Remove Unavailable role"]',
    );
    if (!remove) throw new Error('Expected the unavailable-role action');
    remove.click();

    await vi.waitFor(async () => {
      await fixture.whenStable();
      expect(buttonByText(root, 'Save')?.disabled).toBe(false);
    });
    fixture.componentInstance.save();

    expect(close).toHaveBeenCalledWith({
      announcementRoleIds: [],
    });
  });

  it('keeps save disabled when the role catalog fails to load', async () => {
    loadRoles.mockRejectedValue(new Error('Role catalog unavailable'));
    const fixture = TestBed.createComponent(
      UpdateAnnouncementDiscoveryDialogComponent,
    );
    const root = fixture.nativeElement as HTMLElement;

    await vi.waitFor(async () => {
      await fixture.whenStable();
      expect(root.textContent).toContain('Roles could not be loaded.');
    });

    expect(buttonByText(root, 'Save')?.disabled).toBe(true);
    fixture.componentInstance.save();
    expect(close).not.toHaveBeenCalled();
  });
});
