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
  createTemplateGraphQuestionFormModel,
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

  it('requires a paid registration to cost at least 0.01', () => {
    const model = createOrdinaryTemplateGraphFormModel();
    const option = model.registrationOptions[0];
    if (!option) throw new Error('Expected a registration option');
    option.isPaid = true;
    option.price = 0;
    option.stripeTaxRateId = 'txr_test';

    const graph = form(signal(model), ordinaryTemplateGraphFormSchema, {
      injector: TestBed.inject(Injector),
    });
    const price = graph.registrationOptions[0].price;

    expect(
      price()
        .errors()
        .map((error) => error.message),
    ).toContain('Paid registrations must cost at least 0.01.');

    price().value.set(1);

    expect(price().errors()).toEqual([]);
  });

  it('keeps a free registration with a zero price valid and hidden', () => {
    const model = createOrdinaryTemplateGraphFormModel();
    const option = model.registrationOptions[0];
    if (!option) throw new Error('Expected a registration option');
    option.isPaid = false;
    option.price = 0;

    const graph = form(signal(model), ordinaryTemplateGraphFormSchema, {
      injector: TestBed.inject(Injector),
    });
    const price = graph.registrationOptions[0].price;

    expect(price().hidden()).toBe(true);
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

  it('rejects cleared required graph numbers', () => {
    const model = createOrdinaryTemplateGraphFormModel();
    const option = model.registrationOptions[0];
    if (!option) throw new Error('Expected a registration option');
    const addOn = createTemplateGraphAddonFormModel(option.key);
    const mapping = addOn.registrationOptions[0];
    if (!mapping) throw new Error('Expected an add-on mapping');
    const question = createTemplateGraphQuestionFormModel(option.key);

    Reflect.set(option, 'closeRegistrationOffset', null);
    Reflect.set(option, 'openRegistrationOffset', null);
    Reflect.set(option, 'spots', null);
    Reflect.set(addOn, 'maxQuantityPerUser', null);
    Reflect.set(addOn, 'totalAvailableQuantity', null);
    Reflect.set(mapping, 'includedQuantity', null);
    Reflect.set(mapping, 'optionalPurchaseQuantity', null);
    Reflect.set(question, 'sortOrder', null);
    model.addOns = [addOn];
    model.questions = [question];

    const graph = form(signal(model), ordinaryTemplateGraphFormSchema, {
      injector: TestBed.inject(Injector),
    });

    expect(
      graph.registrationOptions[0].closeRegistrationOffset().errors(),
    ).not.toEqual([]);
    expect(
      graph.registrationOptions[0].openRegistrationOffset().errors(),
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

  it('rejects unfinished uploads and registration windows that close before opening', () => {
    const model = createOrdinaryTemplateGraphFormModel();
    const option = model.registrationOptions[0];
    if (!option) throw new Error('Expected a registration option');
    option.description = '<img src="blob:pending-upload" />';
    option.openRegistrationOffset = 10;
    option.closeRegistrationOffset = 11;

    const graph = form(signal(model), ordinaryTemplateGraphFormSchema, {
      injector: TestBed.inject(Injector),
    });

    expect(
      graph.registrationOptions[0]
        .description()
        .errors()
        .map((error) => error.message),
    ).toContain('Wait for image uploads to finish before saving.');
    expect(
      graph.registrationOptions[0]
        .closeRegistrationOffset()
        .errors()
        .map((error) => error.message),
    ).toContain('Registration must open before it closes.');
  });

  it('rejects add-on purchase-window and mapping combinations the server cannot save', () => {
    const model = createOrdinaryTemplateGraphFormModel();
    const option = model.registrationOptions[0];
    if (!option) throw new Error('Expected a registration option');
    const addOn = createTemplateGraphAddonFormModel(option.key);
    const mapping = addOn.registrationOptions[0];
    if (!mapping) throw new Error('Expected an add-on mapping');
    addOn.allowPurchaseBeforeEvent = false;
    addOn.allowPurchaseDuringEvent = false;
    addOn.allowPurchaseDuringRegistration = false;
    addOn.registrationOptions = [mapping, { ...mapping }];
    model.addOns = [addOn];

    const graph = form(signal(model), ordinaryTemplateGraphFormSchema, {
      injector: TestBed.inject(Injector),
    });

    expect(
      graph.addOns[0]
        .allowPurchaseDuringRegistration()
        .errors()
        .map((error) => error.message),
    ).toContain('Choose when this add-on is available.');
    expect(
      graph.addOns[0]
        .registrationOptions()
        .errors()
        .map((error) => error.message),
    ).toContain('Use each registration option only once.');
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
