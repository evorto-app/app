import { Injector, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { form } from '@angular/forms/signals';
import { readFileSync } from 'node:fs';
import nodePath from 'node:path';
import { describe, expect, it } from 'vitest';

import { roleFormSubmitDisabled } from './role-form.component';
import { createRoleFormModel, roleFormSchema } from './role-form.schema';

const template = readFileSync(
  nodePath.join(
    process.cwd(),
    'src/app/admin/components/role-form/role-form.component.html',
  ),
  'utf8',
);

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
  it('provides visible required and length messages', () => {
    TestBed.configureTestingModule({});
    const roleForm = form(signal(createRoleFormModel()), roleFormSchema, {
      injector: TestBed.inject(Injector),
    });

    expect(
      roleForm
        .name()
        .errors()
        .map((error) => error.message),
    ).toContain('Enter a role name.');
    roleForm.name().value.set('x'.repeat(101));
    roleForm.description().value.set('x'.repeat(501));

    expect(
      roleForm
        .name()
        .errors()
        .map((error) => error.message),
    ).toContain('Name must be 100 characters or fewer.');
    expect(
      roleForm
        .description()
        .errors()
        .map((error) => error.message),
    ).toContain('Description must be 500 characters or fewer.');
    expect(template).toContain('error of form.name().errors()');
    expect(template).toContain('error of form.description().errors()');
    expect(template).toContain('<mat-error>{{ error.message }}</mat-error>');
  });
});
