import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { form } from '@angular/forms/signals';
import { describe, expect, it } from 'vitest';

import {
  RoleFormComponent,
  roleFormSubmitDisabled,
} from './role-form.component';
import {
  createRoleFormModel,
  mergeRoleFormOverrides,
  type RoleFormData,
  roleFormSchema,
} from './role-form.schema';

describe('roleFormSubmitDisabled', () => {
  it('blocks role submits while invalid, submitting, or mutation-pending', () => {
    expect(
      roleFormSubmitDisabled({
        formInvalid: true,
        formSubmitting: false,
        mutationPending: false,
      }),
    ).toBe(true);
    expect(
      roleFormSubmitDisabled({
        formInvalid: false,
        formSubmitting: true,
        mutationPending: false,
      }),
    ).toBe(true);
    expect(
      roleFormSubmitDisabled({
        formInvalid: false,
        formSubmitting: false,
        mutationPending: true,
      }),
    ).toBe(true);
    expect(
      roleFormSubmitDisabled({
        formInvalid: false,
        formSubmitting: false,
        mutationPending: false,
      }),
    ).toBe(false);
  });
});

describe('role write validation', () => {
  it('renders required and length errors for the edited fields', async () => {
    const fixture = createRoleFormFixture();
    await fixture.whenStable();
    const root: unknown = fixture.nativeElement;
    if (!(root instanceof HTMLElement))
      throw new Error('Expected the rendered role form');
    const name = root.querySelector<HTMLInputElement>('input[matinput]');
    const description = root.querySelector<HTMLTextAreaElement>('textarea');
    if (!name || !description)
      throw new Error('Expected role name and description fields');
    name.value = '';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    name.dispatchEvent(new Event('blur'));
    await fixture.whenStable();
    expect(root.textContent).toContain('Enter a role name.');

    name.value = 'x'.repeat(101);
    description.value = 'x'.repeat(501);
    name.dispatchEvent(new Event('input', { bubbles: true }));
    description.dispatchEvent(new Event('input', { bubbles: true }));
    description.dispatchEvent(new Event('blur'));
    await fixture.whenStable();
    expect(root.textContent).toContain('Name must be 100 characters or fewer.');
    expect(root.textContent).toContain(
      'Description must be 500 characters or fewer.',
    );
  });
});

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RoleFormComponent],
  template:
    '<app-role-form [roleForm]="roleForm" (formSubmit)="submitted.set($event)" />',
})
class RoleFormHost {
  readonly model = signal(createRoleFormModel({ name: 'Member' }));
  readonly roleForm = form(this.model, roleFormSchema);
  readonly submitted = signal<RoleFormData | undefined>(undefined);
}

const submitVisibleRoleForm = async (
  fixture: ReturnType<typeof createRoleFormFixture>,
) => {
  const root: HTMLElement = fixture.nativeElement;
  const button = root.querySelector('button[type="submit"]');
  if (!(button instanceof HTMLButtonElement))
    throw new Error('Missing role submit button');
  expect(button.disabled).toBe(false);
  button.click();
  await fixture.whenStable();
};

const createRoleFormFixture = () => {
  TestBed.configureTestingModule({ imports: [RoleFormHost] });
  return TestBed.createComponent(RoleFormHost);
};

describe('stored role authority in the form', () => {
  it('preserves unchanged wildcards and expands only a grant whose capability is revoked', async () => {
    const fixture = createRoleFormFixture();
    const host = fixture.componentInstance;
    host.model.set(
      createRoleFormModel({
        name: 'Administrator',
        permissions: ['admin:*', 'users:*'],
      }),
    );
    fixture.detectChanges();
    await fixture.whenStable();
    expect(host.roleForm.permissions['admin:manageRoles']().value()).toBe(true);
    expect(host.roleForm.permissions['admin:changeSettings']().value()).toBe(
      true,
    );
    expect(host.roleForm.permissions['admin:managePayments']().value()).toBe(
      true,
    );
    expect(host.roleForm.permissions['admin:tax']().value()).toBe(true);
    host.model.set(
      mergeRoleFormOverrides({ name: 'Renamed administrator' }, host.model()),
    );
    fixture.detectChanges();
    await submitVisibleRoleForm(fixture);
    expect(host.submitted()?.name).toBe('Renamed administrator');
    expect(host.submitted()?.permissions).toEqual(['admin:*', 'users:*']);
    expect(host.submitted()).not.toHaveProperty('originalPermissions');

    host.roleForm.permissions['events:seeDrafts']().value.set(true);
    fixture.detectChanges();
    await submitVisibleRoleForm(fixture);
    expect(host.submitted()?.permissions).toEqual([
      'admin:*',
      'users:*',
      'events:seeDrafts',
    ]);

    host.roleForm.permissions['admin:manageRoles']().value.set(false);
    fixture.detectChanges();
    await submitVisibleRoleForm(fixture);
    expect(host.submitted()?.permissions).toEqual([
      'users:*',
      'admin:changeSettings',
      'admin:managePayments',
      'admin:tax',
      'events:seeDrafts',
    ]);
  });

  it('shows tax authority and allows that displayed grant to be revoked', async () => {
    const fixture = createRoleFormFixture();
    const host = fixture.componentInstance;
    host.model.set(
      createRoleFormModel({
        name: 'Tax manager',
        permissions: ['admin:tax'],
      }),
    );
    fixture.detectChanges();
    await fixture.whenStable();
    expect(host.roleForm.permissions['admin:tax']().value()).toBe(true);
    await submitVisibleRoleForm(fixture);
    expect(host.submitted()?.permissions).toEqual(['admin:tax']);
    host.roleForm.permissions['admin:tax']().value.set(false);
    fixture.detectChanges();
    await submitVisibleRoleForm(fixture);
    expect(host.submitted()?.permissions).toEqual([]);
  });

  it('shows implied access and permits its removal after its parent grant is unchecked', async () => {
    const fixture = createRoleFormFixture();
    const host = fixture.componentInstance;
    host.model.set(
      createRoleFormModel({
        name: 'Author',
        permissions: ['events:create', 'users:viewAll'],
      }),
    );
    fixture.detectChanges();
    await fixture.whenStable();
    expect(host.roleForm.permissions['templates:view']().value()).toBe(true);
    expect(host.roleForm.permissions['templates:view']().readonly()).toBe(true);
    await submitVisibleRoleForm(fixture);
    expect(host.submitted()?.permissions).toEqual([
      'events:create',
      'users:viewAll',
    ]);
    host.roleForm.permissions['events:create']().value.set(false);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(host.roleForm.permissions['templates:view']().readonly()).toBe(
      false,
    );
    host.roleForm.permissions['templates:view']().value.set(false);
    fixture.detectChanges();
    await submitVisibleRoleForm(fixture);
    expect(host.submitted()?.permissions).toEqual(['users:viewAll']);
  });
});
