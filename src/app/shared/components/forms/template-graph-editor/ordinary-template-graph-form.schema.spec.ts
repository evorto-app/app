import { Injector, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { form } from '@angular/forms/signals';
import { beforeEach, describe, expect, it } from 'vitest';

import { createOrdinaryTemplateGraphFormModel } from './ordinary-template-graph-form';
import { ordinaryTemplateGraphFormSchema } from './ordinary-template-graph-form.schema';
import { createTemplateGraphAddonFormModel } from './template-graph-form.model';

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
});
