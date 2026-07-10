import { describe, expect, it } from 'vitest';

import {
  eventEditSubmitDisabled,
  eventOptionRemovalBlockReason,
} from './event-edit';

describe('eventEditSubmitDisabled', () => {
  it('blocks event edit submits while invalid, submitting, or awaiting the mutation', () => {
    expect(
      eventEditSubmitDisabled({
        formInvalid: false,
        formSubmitting: false,
        graphReadOnly: false,
        mutationPending: false,
      }),
    ).toBe(false);
    expect(
      eventEditSubmitDisabled({
        formInvalid: true,
        formSubmitting: false,
        graphReadOnly: false,
        mutationPending: false,
      }),
    ).toBe(true);
    expect(
      eventEditSubmitDisabled({
        formInvalid: false,
        formSubmitting: true,
        graphReadOnly: false,
        mutationPending: false,
      }),
    ).toBe(true);
    expect(
      eventEditSubmitDisabled({
        formInvalid: false,
        formSubmitting: false,
        graphReadOnly: false,
        mutationPending: true,
      }),
    ).toBe(true);
    expect(
      eventEditSubmitDisabled({
        formInvalid: false,
        formSubmitting: false,
        graphReadOnly: true,
        mutationPending: false,
      }),
    ).toBe(true);
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
    ).toContain('add-on mappings');

    expect(
      eventOptionRemovalBlockReason({ addOns: [], questions: [] }, 'option-1'),
    ).toBeNull();
  });
});
