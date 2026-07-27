import '@angular/compiler';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSelectHarness } from '@angular/material/select/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import {
  provideTanStackQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RoleSelectQueries } from '../../shared/components/controls/role-select/role-select.component';
import { UpdateVisibilityDialogComponent } from './update-visibility-dialog.component';

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

describe('UpdateVisibilityDialogComponent', () => {
  const close = vi.fn();
  const loadRoles = vi.fn(async () => [organizerRole]);
  let dialogData: {
    event: {
      announcementRoleIds: string[];
      hasRegistrationOptions: boolean;
      listingAudience: 'organizer';
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
        hasRegistrationOptions: true,
        listingAudience: 'organizer',
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
      imports: [UpdateVisibilityDialogComponent],
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

  it('shows every explicit audience and the semantics of the current selection', async () => {
    const fixture = TestBed.createComponent(UpdateVisibilityDialogComponent);
    await fixture.whenStable();
    const select =
      await TestbedHarnessEnvironment.loader(fixture).getHarness(
        MatSelectHarness,
      );
    await select.open();
    const options = await select.getOptions();
    const text = (fixture.nativeElement as HTMLElement).textContent
      ?.replaceAll(/\s+/g, ' ')
      .trim();

    expect(text).toContain('Update listing for Welcome week');
    expect(await select.getValueText()).toBe('Organizers');
    expect(
      await Promise.all(options.map((option) => option.getText())),
    ).toEqual([
      'Participants',
      'Organizers',
      'Participants and organizers',
      'Unlisted',
    ]);
    expect(text).toContain(
      'Visible to people eligible for at least one organizer registration option.',
    );
  });

  it('saves a successfully loaded empty role selection as link-only discovery', async () => {
    dialogData.event.hasRegistrationOptions = false;
    const fixture = TestBed.createComponent(UpdateVisibilityDialogComponent);
    const root = fixture.nativeElement as HTMLElement;

    await vi.waitFor(async () => {
      await fixture.whenStable();
      expect(buttonByText(root, 'Save')?.disabled).toBe(false);
    });

    const text = root.textContent?.replaceAll(/\s+/g, ' ').trim();
    expect(text).toContain(
      'With no roles selected, the announcement is link-only',
    );
    expect(text).toContain(
      'it does not restrict direct links, grant access, or send notifications',
    );

    fixture.componentInstance.save();

    expect(close).toHaveBeenCalledWith({
      announcementRoleIds: [],
      listingAudience: 'organizer',
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
    dialogData.event.hasRegistrationOptions = false;
    dialogData.event.announcementRoleIds = [organizerRole.id];
    const fixture = TestBed.createComponent(UpdateVisibilityDialogComponent);
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
    dialogData.event.hasRegistrationOptions = false;
    dialogData.event.announcementRoleIds = ['role-deleted'];
    const fixture = TestBed.createComponent(UpdateVisibilityDialogComponent);
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
      listingAudience: 'organizer',
    });
  });

  it('keeps save disabled when the role catalog fails to load', async () => {
    loadRoles.mockRejectedValue(new Error('Role catalog unavailable'));
    dialogData.event.hasRegistrationOptions = false;
    const fixture = TestBed.createComponent(UpdateVisibilityDialogComponent);
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
