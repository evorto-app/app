import { Injector, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { form } from '@angular/forms/signals';
import { beforeEach, describe, expect, it } from 'vitest';

import { createOrdinaryTemplateGraphFormModel } from './ordinary-template-graph-form';
import {
  ordinaryTemplateGraphFormSchema,
  ordinaryTemplateGraphFormSchemaWithPaymentAvailability,
} from './ordinary-template-graph-form.schema';
import {
  createTemplateGraphAddonFormModel,
  resetTemplateGraphPayments,
} from './template-graph-form.model';

describe('ordinaryTemplateGraphFormSchema', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({});
  });

  it('requires a paid add-on to cost at least one cent', () => {
    const graph = form(
      signal(
        createOrdinaryTemplateGraphFormModel({
          addOns: [
            {
              ...createTemplateGraphAddonFormModel(),
              isPaid: true,
              price: 0,
              stripeTaxRateId: 'txr_test',
            },
          ],
        }),
      ),
      ordinaryTemplateGraphFormSchema,
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
      signal(
        createOrdinaryTemplateGraphFormModel({
          addOns: [
            {
              ...createTemplateGraphAddonFormModel(),
              isPaid: false,
              price: 0,
            },
          ],
        }),
      ),
      ordinaryTemplateGraphFormSchema,
      { injector: TestBed.inject(Injector) },
    );
    const price = graph.addOns[0].price;

    expect(price().hidden()).toBe(true);
    expect(price().errors()).toEqual([]);
  });

  it('reactively disables paid controls until Stripe is available', () => {
    const paymentAllowed = signal(false);
    const graph = form(
      signal(
        createOrdinaryTemplateGraphFormModel({
          addOns: [createTemplateGraphAddonFormModel()],
        }),
      ),
      ordinaryTemplateGraphFormSchemaWithPaymentAvailability(() =>
        paymentAllowed(),
      ),
      { injector: TestBed.inject(Injector) },
    );

    expect(graph.registrationOptions[0].isPaid().disabled()).toBe(true);
    expect(graph.registrationOptions[0].price().disabled()).toBe(true);
    expect(graph.addOns[0].isPaid().disabled()).toBe(true);
    expect(graph.addOns[0].price().disabled()).toBe(true);

    paymentAllowed.set(true);

    expect(graph.registrationOptions[0].isPaid().disabled()).toBe(false);
    expect(graph.registrationOptions[0].price().disabled()).toBe(false);
    expect(graph.addOns[0].isPaid().disabled()).toBe(false);
    expect(graph.addOns[0].price().disabled()).toBe(false);
  });

  it('clears only template payment fields after a confirmed disconnect', () => {
    const source = createOrdinaryTemplateGraphFormModel({
      addOns: [
        {
          ...createTemplateGraphAddonFormModel(),
          isPaid: true,
          price: 500,
          stripeTaxRateId: 'txr_addon',
          title: 'Retained add-on',
        },
      ],
      title: 'Retained template',
    });
    source.registrationOptions[0] = {
      ...source.registrationOptions[0],
      esnCardDiscountedPrice: 800,
      isPaid: true,
      price: 1000,
      roleIds: ['role-1'],
      stripeTaxRateId: 'txr_option',
    };

    const reset = resetTemplateGraphPayments(source);

    expect(reset.title).toBe('Retained template');
    expect(reset.registrationOptions[0]).toMatchObject({
      esnCardDiscountedPrice: '',
      isPaid: false,
      price: 0,
      roleIds: ['role-1'],
      stripeTaxRateId: '',
    });
    expect(reset.addOns[0]).toMatchObject({
      isPaid: false,
      price: 0,
      stripeTaxRateId: '',
      title: 'Retained add-on',
    });
  });
});
