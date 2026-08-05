import { Injector, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { form } from '@angular/forms/signals';
import {
  MAX_EVENT_ADDON_TYPES,
  MAX_REGISTRATION_ADDON_QUANTITY,
} from '@shared/registration-quantity-limits';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  createEmptyEventGraphFormModel,
  createEventGraphAddon,
  createEventGraphQuestion,
  createEventGraphRegistrationOption,
} from './event-graph-form.model';
import {
  eventGraphFormSchema,
  eventGraphFormSchemaWithPaymentAvailability,
} from './event-graph-form.schema';

describe('eventGraphFormSchema', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({});
  });

  it('requires the event to end after it starts', () => {
    const model = createEmptyEventGraphFormModel('Europe/Berlin');
    const graph = form(signal(model), eventGraphFormSchema, {
      injector: TestBed.inject(Injector),
    });

    expect(
      graph
        .end()
        .errors()
        .map((error) => error.message),
    ).toContain('The event must end after it starts.');

    graph.end().value.set(model.start.plus({ minutes: 1 }));

    expect(graph.end().errors()).toEqual([]);
  });

  it('requires a paid add-on to cost at least 0.01', () => {
    const graph = form(
      signal({
        ...createEmptyEventGraphFormModel('Europe/Berlin'),
        addOns: [
          {
            ...createEventGraphAddon(),
            isPaid: true,
            price: 0,
            stripeTaxRateId: 'txr_test',
          },
        ],
      }),
      eventGraphFormSchema,
      { injector: TestBed.inject(Injector) },
    );
    const price = graph.addOns[0].price;

    expect(
      price()
        .errors()
        .map((error) => error.message),
    ).toContain('Paid add-ons must cost at least 0.01.');

    price().value.set(1);

    expect(price().errors()).toEqual([]);
  });

  it('requires a paid registration to cost at least 0.01', () => {
    const model = createEmptyEventGraphFormModel('Europe/Berlin');
    const option = {
      ...createEventGraphRegistrationOption(model),
      isPaid: true,
      price: 0,
      stripeTaxRateId: 'txr_test',
    };
    const graph = form(
      signal({ ...model, registrationOptions: [option] }),
      eventGraphFormSchema,
      { injector: TestBed.inject(Injector) },
    );
    const price = graph.registrationOptions[0].price;

    expect(
      price()
        .errors()
        .map((error) => error.message),
    ).toContain('A paid choice must cost at least 0.01.');

    price().value.set(1);

    expect(price().errors()).toEqual([]);
  });

  it('keeps a free registration with a zero price valid and hidden', () => {
    const model = createEmptyEventGraphFormModel('Europe/Berlin');
    const option = {
      ...createEventGraphRegistrationOption(model),
      isPaid: false,
      price: 0,
    };
    const graph = form(
      signal({ ...model, registrationOptions: [option] }),
      eventGraphFormSchema,
      { injector: TestBed.inject(Injector) },
    );
    const price = graph.registrationOptions[0].price;

    expect(price().hidden()).toBe(true);
    expect(price().errors()).toEqual([]);
  });

  it('keeps a free add-on with a zero price valid and hidden', () => {
    const graph = form(
      signal({
        ...createEmptyEventGraphFormModel('Europe/Berlin'),
        addOns: [
          {
            ...createEventGraphAddon(),
            isPaid: false,
            price: 0,
          },
        ],
      }),
      eventGraphFormSchema,
      { injector: TestBed.inject(Injector) },
    );
    const price = graph.addOns[0].price;

    expect(price().hidden()).toBe(true);
    expect(price().errors()).toEqual([]);
  });

  it('accepts add-on quantity caps and rejects cap plus one', () => {
    const model = createEmptyEventGraphFormModel('Europe/Berlin');
    const option = createEventGraphRegistrationOption(model);
    const addOn = createEventGraphAddon(option.key);
    const mapping = addOn.registrationOptions[0];
    if (!mapping) throw new Error('Expected an add-on mapping');
    addOn.maxQuantityPerUser = MAX_REGISTRATION_ADDON_QUANTITY;
    mapping.includedQuantity = 4;
    mapping.optionalPurchaseQuantity = MAX_REGISTRATION_ADDON_QUANTITY - 4;
    model.registrationOptions = [option];
    model.addOns = [addOn];

    const graph = form(signal(model), eventGraphFormSchema, {
      injector: TestBed.inject(Injector),
    });

    expect(graph.addOns[0].maxQuantityPerUser().errors()).toEqual([]);
    expect(
      graph.addOns[0].registrationOptions[0].includedQuantity().errors(),
    ).toEqual([]);

    graph.addOns[0]
      .maxQuantityPerUser()
      .value.set(MAX_REGISTRATION_ADDON_QUANTITY + 1);
    expect(
      graph.addOns[0]
        .maxQuantityPerUser()
        .errors()
        .map((error) => error.message),
    ).toContain(
      `Each person can buy at most ${MAX_REGISTRATION_ADDON_QUANTITY} items.`,
    );

    graph.addOns[0]
      .maxQuantityPerUser()
      .value.set(MAX_REGISTRATION_ADDON_QUANTITY);
    graph.addOns[0].registrationOptions[0]
      .optionalPurchaseQuantity()
      .value.set(MAX_REGISTRATION_ADDON_QUANTITY - 3);
    expect(
      graph.addOns[0].registrationOptions[0]
        .includedQuantity()
        .errors()
        .map((error) => error.message),
    ).toContain(
      `Included and optional items cannot exceed ${MAX_REGISTRATION_ADDON_QUANTITY} per sign-up.`,
    );
  });

  it('accepts the add-on type cap and rejects cap plus one', () => {
    const model = createEmptyEventGraphFormModel('Europe/Berlin');
    model.addOns = Array.from({ length: MAX_EVENT_ADDON_TYPES }, () =>
      createEventGraphAddon(),
    );
    const graph = form(signal(model), eventGraphFormSchema, {
      injector: TestBed.inject(Injector),
    });

    expect(graph.addOns().errors()).toEqual([]);

    graph.addOns().value.set([...model.addOns, createEventGraphAddon()]);
    expect(
      graph
        .addOns()
        .errors()
        .map((error) => error.message),
    ).toContain(`An event can have at most ${MAX_EVENT_ADDON_TYPES} add-ons.`);
  });

  it('rejects cleared required dates and graph numbers without throwing', () => {
    const model = createEmptyEventGraphFormModel('Europe/Berlin');
    const option = createEventGraphRegistrationOption(model);
    const addOn = createEventGraphAddon(option.key);
    const question = createEventGraphQuestion(option.key, 0);
    const mapping = addOn.registrationOptions[0];
    if (!mapping) throw new Error('Expected an add-on mapping');

    Reflect.set(model, 'start', null);
    Reflect.set(model, 'end', null);
    Reflect.set(option, 'openRegistrationTime', null);
    Reflect.set(option, 'closeRegistrationTime', null);
    Reflect.set(option, 'price', null);
    Reflect.set(option, 'spots', null);
    Reflect.set(addOn, 'maxQuantityPerUser', null);
    Reflect.set(addOn, 'totalAvailableQuantity', null);
    Reflect.set(mapping, 'includedQuantity', null);
    Reflect.set(mapping, 'optionalPurchaseQuantity', null);
    Reflect.set(question, 'sortOrder', null);
    model.registrationOptions = [option];
    model.addOns = [addOn];
    model.questions = [question];

    const graph = form(signal(model), eventGraphFormSchema, {
      injector: TestBed.inject(Injector),
    });

    expect(graph.start().errors()).not.toEqual([]);
    expect(graph.end().errors()).not.toEqual([]);
    expect(
      graph.registrationOptions[0].openRegistrationTime().errors(),
    ).not.toEqual([]);
    expect(
      graph.registrationOptions[0].closeRegistrationTime().errors(),
    ).not.toEqual([]);
    expect(graph.registrationOptions[0].spots().errors()).not.toEqual([]);
    expect(graph.addOns[0].maxQuantityPerUser().errors()).not.toEqual([]);
    expect(graph.addOns[0].totalAvailableQuantity().errors()).not.toEqual([]);
    expect(
      graph.addOns[0].registrationOptions[0].includedQuantity().errors(),
    ).not.toEqual([]);
    expect(
      graph.addOns[0].registrationOptions[0]
        .optionalPurchaseQuantity()
        .errors(),
    ).not.toEqual([]);
    expect(graph.questions[0].sortOrder().errors()).not.toEqual([]);
  });

  it('reactively disables payment toggles when Stripe is unavailable', () => {
    const paymentAllowed = signal(false);
    const graph = form(
      signal({
        ...createEmptyEventGraphFormModel('Europe/Berlin'),
        addOns: [createEventGraphAddon()],
      }),
      eventGraphFormSchemaWithPaymentAvailability(() => paymentAllowed()),
      { injector: TestBed.inject(Injector) },
    );

    expect(graph.addOns[0].isPaid().disabled()).toBe(true);
    expect(graph.addOns[0].price().disabled()).toBe(true);

    paymentAllowed.set(true);

    expect(graph.addOns[0].isPaid().disabled()).toBe(false);
    expect(graph.addOns[0].price().disabled()).toBe(false);
  });
});
