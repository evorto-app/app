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

describe('RoleSelectComponent', () => {
  let fixture: ComponentFixture<RoleSelectComponent>;
  let queryClient: QueryClient;

  beforeEach(async () => {
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
            findMany: (search: string) => ({
              queryFn: async () => [],
              queryKey: ['roles', 'search', search],
            }),
            findOne: (id: string) => ({
              queryFn: async () => ({ ...role, id }),
              queryKey: ['roles', id],
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
      'input[placeholder="Add Role..."]',
    );
    expect(roleInput.tabIndex).toBe(0);

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
    expect(await formField.getLabel()).toBe('Selected Roles');

    const roleInput: HTMLInputElement = fixture.nativeElement.querySelector(
      'input[placeholder="Add Role..."]',
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
        'input[placeholder="Add Role..."]',
      );

      expect(chipGrid.getAttribute('aria-disabled')).toBe('true');
      expect(removeButton.disabled).toBe(true);
      expect(roleInput.disabled).toBe(true);

      removeButton.click();
      fixture.detectChanges();
      expect(fixture.componentInstance.value()).toEqual([role.id]);
    },
  );

  it('tracks multiple role queries uniquely while the value resets', async () => {
    fixture.componentRef.setInput('value', ['role-organizer', 'role-finance']);
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(
        fixture.nativeElement.querySelectorAll('mat-chip-row'),
      ).toHaveLength(2);
    });
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
