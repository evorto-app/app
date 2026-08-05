import { Injector, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { form } from '@angular/forms/signals';
import { readFileSync } from 'node:fs';
import nodePath from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  nonNegativeIntegerValidationError,
  registrationSettingsFormSchema,
} from './registration-settings.component';

const template = readFileSync(
  nodePath.join(
    process.cwd(),
    'src/app/admin/settings/registration-settings.component.html',
  ),
  'utf8',
);

beforeEach(() => {
  TestBed.configureTestingModule({});
});

describe('registration policy validation', () => {
  it('requires every numeric policy value before settings can be saved', () => {
    const model = {
      cancellationDeadlineHoursBeforeStart: 120,
      maxActiveRegistrationsPerUser: 0,
      transferDeadlineHoursBeforeStart: 0,
    };
    Reflect.set(model, 'cancellationDeadlineHoursBeforeStart', null);
    Reflect.set(model, 'maxActiveRegistrationsPerUser', null);
    Reflect.set(model, 'transferDeadlineHoursBeforeStart', null);
    const settings = form(signal(model), registrationSettingsFormSchema, {
      injector: TestBed.inject(Injector),
    });

    expect(
      settings
        .cancellationDeadlineHoursBeforeStart()
        .errors()
        .map((error) => error.message),
    ).toContain('Enter a cancellation deadline.');
    expect(
      settings
        .maxActiveRegistrationsPerUser()
        .errors()
        .map((error) => error.message),
    ).toContain('Enter an active sign-up limit.');
    expect(
      settings
        .transferDeadlineHoursBeforeStart()
        .errors()
        .map((error) => error.message),
    ).toContain('Enter a transfer deadline.');
  });

  it.each([
    { expected: undefined, value: 0 },
    { expected: undefined, value: 12 },
    {
      expected: {
        kind: 'integer',
        message: 'Enter a whole number.',
      },
      value: 1.5,
    },
    {
      expected: {
        kind: 'nonNegative',
        message: 'Enter zero or more.',
      },
      value: -1,
    },
  ])('validates $value without changing it', ({ expected, value }) => {
    expect(nonNegativeIntegerValidationError(value)).toEqual(expected);
  });

  it('rejects fractional and negative settings in the form schema', () => {
    const settings = form(
      signal({
        cancellationDeadlineHoursBeforeStart: -1,
        maxActiveRegistrationsPerUser: 1.5,
        transferDeadlineHoursBeforeStart: 2.5,
      }),
      registrationSettingsFormSchema,
      {
        injector: TestBed.inject(Injector),
      },
    );

    expect(
      settings
        .maxActiveRegistrationsPerUser()
        .errors()
        .map((error) => error.message),
    ).toContain('Enter a whole number.');
    expect(
      settings
        .cancellationDeadlineHoursBeforeStart()
        .errors()
        .map((error) => error.message),
    ).toContain('Enter zero or more.');
    expect(
      settings
        .transferDeadlineHoursBeforeStart()
        .errors()
        .map((error) => error.message),
    ).toContain('Enter a whole number.');
  });

  it('renders each numeric setting error and the waitlist limit rule', () => {
    expect(template).toContain(
      'settingsForm.maxActiveRegistrationsPerUser().errors()',
    );
    expect(template).toContain(
      'settingsForm.transferDeadlineHoursBeforeStart().errors()',
    );
    expect(template).toMatch(
      /settingsForm\s*\.cancellationDeadlineHoursBeforeStart\(\)\s*\.errors\(\)/,
    );
    expect(template).toMatch(/Joining a waitlist does not count\s+toward this/);
  });
});
