import type { TaxRatesListActiveRecord } from '@shared/rpc-contracts/app-rpcs/tax-rates.rpcs';

import { Injector, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { form } from '@angular/forms/signals';
import {
  MAX_EVENT_ADDON_TYPES,
  MAX_REGISTRATION_ADDON_QUANTITY,
} from '@shared/registration-quantity-limits';
import {
  MAX_REGISTRATION_QUESTION_DESCRIPTION_LENGTH,
  MAX_REGISTRATION_QUESTION_TITLE_LENGTH,
  MAX_REGISTRATION_QUESTIONS,
} from '@shared/registration-question-limits';
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
    ).toContain('Paid choices must cost at least 0.01.');

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
    ).toContain('Use each sign-up choice only once.');
  });

  it('reactively disables paid controls until Stripe is available', () => {
    const paymentAllowed = signal(false);
    const graph = form(
      signal(
        createOrdinaryTemplateGraphFormModel({
          addOns: [createTemplateGraphAddonFormModel()],
        }),
      ),
      ordinaryTemplateGraphFormSchemaWithPaymentAvailability(
        () => paymentAllowed(),
        () => [],
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

  it.each(['registration', 'addon'] as const)(
    'revalidates a retained paid %s tax rate against the usable catalog without clearing it',
    (kind) => {
      const rates = signal<readonly TaxRatesListActiveRecord[] | undefined>(
        undefined,
      );
      const model = createOrdinaryTemplateGraphFormModel({
        addOns: [
          {
            ...createTemplateGraphAddonFormModel(),
            isPaid: true,
            price: 100,
            stripeTaxRateId: 'txr-retained',
          },
        ],
      });
      const option = model.registrationOptions[0];
      if (!option) throw new Error('Expected a registration option');
      option.isPaid = true;
      option.price = 100;
      option.stripeTaxRateId = 'txr-retained';
      const graph = form(
        signal(model),
        ordinaryTemplateGraphFormSchemaWithPaymentAvailability(
          () => true,
          rates,
        ),
        { injector: TestBed.inject(Injector) },
      );
      const selected =
        kind === 'addon' ? graph.addOns[0] : graph.registrationOptions[0];
      expect(selected.stripeTaxRateId().errors()).toEqual([]);
      rates.set([]);
      expect(selected.stripeTaxRateId().errors()).toEqual([
        expect.objectContaining({ kind: 'unavailableTaxRate' }),
      ]);
      const rate: TaxRatesListActiveRecord = {
        country: 'DE',
        displayName: 'Standard',
        id: 'retained',
        percentage: null,
        state: null,
        stripeTaxRateId: 'txr-retained',
      };
      for (const percentage of [null, '', ' '.repeat(3), '\t\n']) {
        rates.set([{ ...rate, percentage }]);
        expect(selected.stripeTaxRateId().invalid()).toBe(true);
      }
      for (const percentage of ['0', '19', ' 7.5 ']) {
        rates.set([{ ...rate, percentage }]);
        expect(selected.stripeTaxRateId().valid()).toBe(true);
      }
      rates.set([]);
      expect(selected.stripeTaxRateId().invalid()).toBe(true);
      selected.isPaid().value.set(false);
      expect(selected.stripeTaxRateId().errors()).toEqual([]);
      expect(selected.stripeTaxRateId().value()).toBe('txr-retained');
    },
  );

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

  it('enforces add-on and sign-up question limits', () => {
    const model = createOrdinaryTemplateGraphFormModel();
    const option = model.registrationOptions[0];
    if (!option) throw new Error('Expected a registration option');
    model.addOns = Array.from({ length: MAX_EVENT_ADDON_TYPES }, () =>
      createTemplateGraphAddonFormModel(),
    );
    model.questions = Array.from({ length: MAX_REGISTRATION_QUESTIONS }, () =>
      createTemplateGraphQuestionFormModel(option.key),
    );
    const graph = form(signal(model), ordinaryTemplateGraphFormSchema, {
      injector: TestBed.inject(Injector),
    });

    expect(graph.addOns().errors()).toEqual([]);
    expect(graph.questions().errors()).toEqual([]);

    graph
      .addOns()
      .value.set([...model.addOns, createTemplateGraphAddonFormModel()]);
    graph
      .questions()
      .value.set([
        ...model.questions,
        createTemplateGraphQuestionFormModel(option.key),
      ]);

    expect(
      graph
        .addOns()
        .errors()
        .map((error) => error.message),
    ).toContain(
      `A template can have at most ${MAX_EVENT_ADDON_TYPES} add-ons.`,
    );
    expect(
      graph
        .questions()
        .errors()
        .map((error) => error.message),
    ).toContain(
      `A template can have at most ${MAX_REGISTRATION_QUESTIONS} sign-up questions.`,
    );
  });

  it('enforces sign-up question text limits', () => {
    const model = createOrdinaryTemplateGraphFormModel();
    const option = model.registrationOptions[0];
    if (!option) throw new Error('Expected a registration option');
    model.questions = [createTemplateGraphQuestionFormModel(option.key)];
    const graph = form(signal(model), ordinaryTemplateGraphFormSchema, {
      injector: TestBed.inject(Injector),
    });

    graph.questions[0]
      .title()
      .value.set('Q'.repeat(MAX_REGISTRATION_QUESTION_TITLE_LENGTH + 1));
    graph.questions[0]
      .description()
      .value.set('D'.repeat(MAX_REGISTRATION_QUESTION_DESCRIPTION_LENGTH + 1));

    expect(
      graph.questions[0]
        .title()
        .errors()
        .map((error) => error.message),
    ).toContain(
      `Questions must be ${MAX_REGISTRATION_QUESTION_TITLE_LENGTH} characters or fewer.`,
    );
    expect(
      graph.questions[0]
        .description()
        .errors()
        .map((error) => error.message),
    ).toContain(
      `Question descriptions must be ${MAX_REGISTRATION_QUESTION_DESCRIPTION_LENGTH} characters or fewer.`,
    );
  });
});
