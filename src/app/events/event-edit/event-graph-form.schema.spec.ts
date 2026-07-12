import { Injector, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { form } from '@angular/forms/signals';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  createEmptyEventGraphFormModel,
  createEventGraphAddon,
} from './event-graph-form.model';
import {
  eventGraphFormSchema,
  eventGraphFormSchemaWithPaymentAvailability,
} from './event-graph-form.schema';

describe('eventGraphFormSchema', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({});
  });

  it('requires a paid add-on to cost at least one cent', () => {
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
    ).toContain('Paid add-ons must cost at least one cent.');

    price().value.set(1);

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
