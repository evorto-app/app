import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatChipGridHarness } from '@angular/material/chips/testing';
import { MatFormFieldHarness } from '@angular/material/form-field/testing';
import {
  provideTanStackQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  RoleSelectComponent,
  RoleSelectQueries,
} from './role-select.component';

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

describe('RoleSelectComponent', () => {
  let fixture: ComponentFixture<RoleSelectComponent>;
  const loadRoles = vi.fn(async () => [role, financeRole]);
  let queryClient: QueryClient;

  beforeEach(async () => {
    loadRoles.mockReset().mockResolvedValue([role, financeRole]);
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          gcTime: 0,
          retry: false,
        },
      },
    });

    await TestBed.configureTestingModule({
      imports: [RoleSelectComponent],
      providers: [
        provideTanStackQuery(queryClient),
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
      'button[aria-label="Remove Unavailable role"]',
    );
    if (!removeButton) throw new Error('Expected the unavailable-role action');
    removeButton.click();
    await fixture.whenStable();

    expect(fixture.componentInstance.value()).toEqual([]);
    expect(fixture.componentInstance.selectionValid()).toBe(true);
  });

  it('keeps an unavailable catalog distinct from an empty catalog and retries', async () => {
    loadRoles
      .mockRejectedValueOnce(new Error('Role provider unavailable'))
      .mockResolvedValue([role, financeRole]);

    await queryClient.resetQueries({ queryKey: ['roles', 'catalog'] });

    await vi.waitFor(async () => {
      await fixture.whenStable();
      expect(fixture.nativeElement.textContent).toContain(
        'Roles could not be loaded.',
      );
      expect(
        (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
          'input[placeholder="Add role…"]',
        )?.disabled,
      ).toBe(true);
    });
    expect(fixture.nativeElement.querySelectorAll('mat-chip-row')).toHaveLength(
      0,
    );

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
        'Roles could not be loaded.',
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
});
