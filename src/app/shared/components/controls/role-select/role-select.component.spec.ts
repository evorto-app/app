import { ComponentFixture, TestBed } from '@angular/core/testing';
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
    });

    const removeButton: HTMLButtonElement = fixture.nativeElement.querySelector(
      'button[aria-label="Remove Organizer"]',
    );
    expect(removeButton.getAttribute('aria-label')).not.toContain(
      '[object Object]',
    );
    expect(removeButton.type).toBe('button');

    const roleInput: HTMLInputElement = fixture.nativeElement.querySelector(
      'input[placeholder="Add Role..."]',
    );
    expect(roleInput.tabIndex).toBe(0);

    roleInput.focus();
    expect(document.activeElement).toBe(roleInput);
  });
});
