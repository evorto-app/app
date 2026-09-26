import { Injector, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { form } from '@angular/forms/signals';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  nonNegativeIntegerValidationError,
  registrationSettingsFormSchema,
} from './registration-settings.component';

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
});

describe('preserved registration policy bounds', () => {
  it('rejects invalid policy counts without changing submitted values', () => {
    const initial = {
      cancellationDeadlineHoursBeforeStart: 120,
      maxActiveRegistrationsPerUser: 0,
      transferDeadlineHoursBeforeStart: 0,
    };
    const model = signal(initial);
    const settings = form(model, registrationSettingsFormSchema, {
      injector: TestBed.inject(Injector),
    });
    for (const field of [
      'cancellationDeadlineHoursBeforeStart',
      'maxActiveRegistrationsPerUser',
      'transferDeadlineHoursBeforeStart',
    ] as const) {
      for (const value of [-1, 1.5, 2_147_483_648]) {
        model.set({ ...initial, [field]: value });
        expect(settings[field]().invalid()).toBe(true);
        expect(settings[field]().value()).toBe(value);
      }
      model.set({ ...initial, [field]: 2_147_483_647 });
      expect(settings[field]().valid()).toBe(true);
    }
    model.set({
      cancellationDeadlineHoursBeforeStart: 0,
      maxActiveRegistrationsPerUser: 2_147_483_647,
      transferDeadlineHoursBeforeStart: 0,
    });
    expect(settings().valid()).toBe(true);
  });
});
