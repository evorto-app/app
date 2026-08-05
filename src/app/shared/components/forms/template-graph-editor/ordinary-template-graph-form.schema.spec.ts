import { Injector, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { form } from '@angular/forms/signals';
import {
  MAX_EVENT_ADDON_TYPES,
  MAX_REGISTRATION_ADDON_QUANTITY,
} from '@shared/registration-quantity-limits';
import { readFileSync } from 'node:fs';
import nodePath from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

import { createOrdinaryTemplateGraphFormModel } from './ordinary-template-graph-form';
import {
  ordinaryTemplateGraphFormSchema,
  ordinaryTemplateGraphFormSchemaWithPaymentAvailability,
} from './ordinary-template-graph-form.schema';
import {
  createTemplateGraphAddonFormModel,
  createTemplateGraphQuestionFormModel,
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
    ).toContain('A paid choice must cost at least 0.01.');

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

  it('accepts add-on quantity caps and rejects cap plus one', () => {
    const model = createOrdinaryTemplateGraphFormModel();
    const option = model.registrationOptions[0];
    if (!option) throw new Error('Expected a registration option');
    const addOn = createTemplateGraphAddonFormModel(option.key);
    const mapping = addOn.registrationOptions[0];
    if (!mapping) throw new Error('Expected an add-on mapping');
    addOn.maxQuantityPerUser = MAX_REGISTRATION_ADDON_QUANTITY;
    addOn.totalAvailableQuantity = 20;
    mapping.includedQuantity = 4;
    mapping.optionalPurchaseQuantity = MAX_REGISTRATION_ADDON_QUANTITY - 4;
    model.addOns = [addOn];

    const graph = form(signal(model), ordinaryTemplateGraphFormSchema, {
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
      `Each person can get at most ${MAX_REGISTRATION_ADDON_QUANTITY} items.`,
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
    const model = createOrdinaryTemplateGraphFormModel({
      addOns: Array.from({ length: MAX_EVENT_ADDON_TYPES }, () =>
        createTemplateGraphAddonFormModel(),
      ),
    });
    const graph = form(signal(model), ordinaryTemplateGraphFormSchema, {
      injector: TestBed.inject(Injector),
    });

    expect(graph.addOns().errors()).toEqual([]);

    graph
      .addOns()
      .value.set([...model.addOns, createTemplateGraphAddonFormModel()]);
    expect(
      graph
        .addOns()
        .errors()
        .map((error) => error.message),
    ).toContain(
      `A template can have at most ${MAX_EVENT_ADDON_TYPES} add-ons.`,
    );
  });

  it('renders the same quantity and add-on type limits', () => {
    const schemaSource = readFileSync(
      nodePath.join(
        process.cwd(),
        'src/app/shared/components/forms/template-graph-editor/ordinary-template-graph-form.schema.ts',
      ),
      'utf8',
    );
    const addOnTemplate = readFileSync(
      nodePath.join(
        process.cwd(),
        'src/app/shared/components/forms/template-graph-editor/template-addon-editor.component.html',
      ),
      'utf8',
    );
    const graphTemplate = readFileSync(
      nodePath.join(
        process.cwd(),
        'src/app/shared/components/forms/template-graph-editor/template-graph-editor.component.html',
      ),
      'utf8',
    );

    expect(schemaSource).toContain(
      'max(addOn.maxQuantityPerUser, MAX_REGISTRATION_ADDON_QUANTITY',
    );
    expect(addOnTemplate).toContain(
      'At most {{ maxRegistrationAddonQuantity }} items per sign-up.',
    );
    expect(graphTemplate).toContain(
      '[disabled]="form.addOns.length >= maxEventAddonTypes"',
    );
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

  it('rejects registration windows that close before opening', () => {
    const model = createOrdinaryTemplateGraphFormModel();
    const option = model.registrationOptions[0];
    if (!option) throw new Error('Expected a registration option');
    option.openRegistrationOffset = 10;
    option.closeRegistrationOffset = 11;

    const graph = form(signal(model), ordinaryTemplateGraphFormSchema, {
      injector: TestBed.inject(Injector),
    });

    expect(
      graph.registrationOptions[0]
        .closeRegistrationOffset()
        .errors()
        .map((error) => error.message),
    ).toContain('Sign-up must open before it closes.');
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
    ).toContain('Add each sign-up choice only once.');
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
});
