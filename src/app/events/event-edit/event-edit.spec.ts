import { readFileSync } from 'node:fs';
import nodePath from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  eventEditSubmitDisabled,
  eventOptionRemovalBlockReason,
} from './event-edit';

describe('eventEditSubmitDisabled', () => {
  it('blocks event edit submits while invalid, submitting, or awaiting the mutation', () => {
    expect(
      eventEditSubmitDisabled({
        discountProvidersReady: true,
        formInvalid: false,
        formSubmitting: false,
        graphReadOnly: false,
        mutationPending: false,
      }),
    ).toBe(false);
    expect(
      eventEditSubmitDisabled({
        discountProvidersReady: true,
        formInvalid: true,
        formSubmitting: false,
        graphReadOnly: false,
        mutationPending: false,
      }),
    ).toBe(true);
    expect(
      eventEditSubmitDisabled({
        discountProvidersReady: true,
        formInvalid: false,
        formSubmitting: true,
        graphReadOnly: false,
        mutationPending: false,
      }),
    ).toBe(true);
    expect(
      eventEditSubmitDisabled({
        discountProvidersReady: true,
        formInvalid: false,
        formSubmitting: false,
        graphReadOnly: false,
        mutationPending: true,
      }),
    ).toBe(true);
    expect(
      eventEditSubmitDisabled({
        discountProvidersReady: true,
        formInvalid: false,
        formSubmitting: false,
        graphReadOnly: true,
        mutationPending: false,
      }),
    ).toBe(true);
  });

  it('blocks event edit submits until discount providers resolve successfully', () => {
    expect(
      eventEditSubmitDisabled({
        discountProvidersReady: false,
        formInvalid: false,
        formSubmitting: false,
        graphReadOnly: false,
        mutationPending: false,
      }),
    ).toBe(true);

    const template = readFileSync(
      nodePath.join(process.cwd(), 'src/app/events/event-edit/event-edit.html'),
      'utf8',
    );
    expect(template).toContain('Discount settings could not be loaded.');
    expect(template).toContain('discountProvidersQuery.refetch()');
  });
});

describe('event edit currency inputs', () => {
  it('shows tenant currency amounts while Signal Forms retain minor units', () => {
    const parentTemplate = readFileSync(
      nodePath.join(process.cwd(), 'src/app/events/event-edit/event-edit.html'),
      'utf8',
    );
    const registrationTemplate = readFileSync(
      nodePath.join(
        process.cwd(),
        'src/app/events/event-edit/event-registration-option-editor.html',
      ),
      'utf8',
    );
    const addOnTemplate = readFileSync(
      nodePath.join(
        process.cwd(),
        'src/app/events/event-edit/event-addon-editor.html',
      ),
      'utf8',
    );

    expect(
      parentTemplate.match(/\[currencyCode\]="tenantCurrency\(\)"/g)?.length,
    ).toBe(2);
    expect(
      registrationTemplate.match(/<app-currency-amount-input/g)?.length,
    ).toBe(2);
    expect(addOnTemplate).toContain('<app-currency-amount-input');
    expect(`${registrationTemplate}${addOnTemplate}`).not.toContain('cents');
  });

  it('explains how to add the first add-on', () => {
    const template = readFileSync(
      nodePath.join(process.cwd(), 'src/app/events/event-edit/event-edit.html'),
      'utf8',
    );

    expect(template).toContain(
      'No add-ons yet. Add one to offer extras with registration.',
    );
    expect(template).not.toContain('Add-ons are disabled for this event.');
  });
});

describe('eventOptionRemovalBlockReason', () => {
  it('requires explicit reference cleanup instead of cascading graph deletes', () => {
    expect(
      eventOptionRemovalBlockReason(
        {
          addOns: [],
          questions: [
            {
              description: '',
              id: 'question-1',
              key: 'question-1',
              registrationOptionKey: 'option-1',
              required: false,
              sortOrder: 0,
              title: 'Question',
            },
          ],
        },
        'option-1',
      ),
    ).toContain('questions');

    expect(
      eventOptionRemovalBlockReason(
        {
          addOns: [
            {
              allowMultiple: false,
              allowPurchaseBeforeEvent: false,
              allowPurchaseDuringEvent: false,
              allowPurchaseDuringRegistration: true,
              description: '',
              id: 'addon-1',
              isPaid: false,
              key: 'addon-1',
              maxQuantityPerUser: 1,
              price: 0,
              registrationOptions: [
                {
                  includedQuantity: 1,
                  optionalPurchaseQuantity: 0,
                  registrationOptionKey: 'option-1',
                },
              ],
              stripeTaxRateId: null,
              title: 'Lunch',
              totalAvailableQuantity: 20,
            },
          ],
          questions: [],
        },
        'option-1',
      ),
    ).toContain('from its add-ons');

    expect(
      eventOptionRemovalBlockReason({ addOns: [], questions: [] }, 'option-1'),
    ).toBeNull();
  });
});
