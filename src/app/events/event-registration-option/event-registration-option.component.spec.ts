import { describe, expect, it } from 'vitest';

import {
  registrationAddonMaxSelectableQuantity,
  registrationAddonPurchasePayload,
  registrationAddonSelectedTotalPrice,
  registrationOptionAudienceCopy,
  registrationOptionAvailability,
  registrationOptionAvailableSpots,
  registrationOptionCanJoinWaitlist,
  registrationOptionIsFull,
  registrationOptionSelectedTotalPrice,
  registrationOptionWriteActionDisabled,
  registrationQuestionAnswerPayload,
  registrationQuestionsMissingRequired,
} from './event-registration-option.component';

describe('registrationOptionAudienceCopy', () => {
  it('keeps participant options on registration copy', () => {
    expect(
      registrationOptionAudienceCopy({
        organizingRegistration: false,
        registrationMode: 'fcfs',
      }),
    ).toEqual({
      actionSuffix: 'register',
      helperText: 'Use this option when you are attending the event.',
      label: 'Participant option',
      primaryAction: 'Register',
    });
  });

  it('uses distinct organizer/helper signup copy', () => {
    expect(
      registrationOptionAudienceCopy({
        organizingRegistration: true,
        registrationMode: 'fcfs',
      }),
    ).toEqual({
      actionSuffix: 'sign up as organizer/helper',
      helperText: 'Use this option when you are helping run the event.',
      label: 'Organizer/helper option',
      primaryAction: 'Sign up as organizer/helper',
    });
  });

  it('uses application copy for manual approval participant options', () => {
    expect(
      registrationOptionAudienceCopy({
        organizingRegistration: false,
        registrationMode: 'application',
      }),
    ).toEqual({
      actionSuffix: 'apply',
      helperText:
        'Use this option when you are attending the event. Organizers approve applications before spots are confirmed.',
      label: 'Manual approval option',
      primaryAction: 'Apply for approval',
    });
  });
});

describe('registrationOptionIsFull', () => {
  it('treats confirmed plus reserved spots as unavailable capacity', () => {
    expect(
      registrationOptionIsFull({
        confirmedSpots: 8,
        reservedSpots: 2,
        spots: 10,
      }),
    ).toBe(true);
  });

  it('keeps registration available when any spot remains', () => {
    expect(
      registrationOptionIsFull({
        confirmedSpots: 7,
        reservedSpots: 2,
        spots: 10,
      }),
    ).toBe(false);
  });
});

describe('registrationOptionCanJoinWaitlist', () => {
  it('allows waitlist joining for full participant first-come options', () => {
    expect(
      registrationOptionCanJoinWaitlist({
        confirmedSpots: 8,
        organizingRegistration: false,
        registrationMode: 'fcfs',
        reservedSpots: 2,
        spots: 10,
      }),
    ).toBe(true);
  });

  it('does not offer waitlists for organizer/helper options', () => {
    expect(
      registrationOptionCanJoinWaitlist({
        confirmedSpots: 8,
        organizingRegistration: true,
        registrationMode: 'fcfs',
        reservedSpots: 2,
        spots: 10,
      }),
    ).toBe(false);
  });

  it('does not offer waitlists for stored unsupported participant modes', () => {
    for (const registrationMode of ['application', 'random'] as const) {
      expect(
        registrationOptionCanJoinWaitlist({
          confirmedSpots: 8,
          organizingRegistration: false,
          registrationMode,
          reservedSpots: 2,
          spots: 10,
        }),
      ).toBe(false);
    }
  });

  it('keeps normal registration primary while spots remain', () => {
    expect(
      registrationOptionCanJoinWaitlist({
        confirmedSpots: 7,
        organizingRegistration: false,
        registrationMode: 'fcfs',
        reservedSpots: 2,
        spots: 10,
      }),
    ).toBe(false);
  });
});

describe('registrationOptionAvailableSpots', () => {
  it('subtracts confirmed and reserved spots from total capacity', () => {
    expect(
      registrationOptionAvailableSpots({
        confirmedSpots: 3,
        reservedSpots: 2,
        spots: 10,
      }),
    ).toBe(5);
  });

  it('never returns negative available capacity', () => {
    expect(
      registrationOptionAvailableSpots({
        confirmedSpots: 10,
        reservedSpots: 2,
        spots: 10,
      }),
    ).toBe(0);
  });
});

describe('registrationOptionAvailability', () => {
  const currentTime = new Date('2026-09-15T12:00:00.000Z');

  it('blocks direct registration before the option opens', () => {
    expect(
      registrationOptionAvailability(
        {
          closeRegistrationTime: '2026-09-20T12:00:00.000Z',
          openRegistrationTime: '2026-09-16T12:00:00.000Z',
        },
        currentTime,
      ),
    ).toBe('tooEarly');
  });

  it('blocks direct registration after the option closes', () => {
    expect(
      registrationOptionAvailability(
        {
          closeRegistrationTime: '2026-09-14T12:00:00.000Z',
          openRegistrationTime: '2026-09-10T12:00:00.000Z',
        },
        currentTime,
      ),
    ).toBe('tooLate');
  });

  it('keeps direct registration open inside the registration window', () => {
    expect(
      registrationOptionAvailability(
        {
          closeRegistrationTime: '2026-09-20T12:00:00.000Z',
          openRegistrationTime: '2026-09-10T12:00:00.000Z',
        },
        currentTime,
      ),
    ).toBe('open');
  });
});

describe('registrationOptionSelectedTotalPrice', () => {
  it('uses discounted buyer price for the signed-in user and full price for guests', () => {
    expect(
      registrationOptionSelectedTotalPrice(
        {
          effectivePrice: 1500,
          price: 2000,
        },
        2,
      ),
    ).toBe(5500);
  });

  it('falls back to the option price when no discount is active', () => {
    expect(
      registrationOptionSelectedTotalPrice(
        {
          price: 2000,
        },
        2,
      ),
    ).toBe(6000);
  });

  it('does not let negative guest counts reduce the total', () => {
    expect(
      registrationOptionSelectedTotalPrice(
        {
          effectivePrice: 1500,
          price: 2000,
        },
        -1,
      ),
    ).toBe(1500);
  });
});

describe('registration add-on selections', () => {
  const addOns = [
    {
      id: 'addon-1',
      price: 500,
      registrationOptions: [
        {
          quantity: 2,
          registrationOptionId: 'option-1',
        },
      ],
    },
    {
      id: 'addon-2',
      price: 0,
      registrationOptions: [
        {
          quantity: 1,
          registrationOptionId: 'option-1',
        },
      ],
    },
  ] as const;

  it('normalizes selected add-ons for the registration mutation payload', () => {
    expect(
      registrationAddonPurchasePayload(
        addOns,
        {
          'addon-1': 2,
          'addon-2': 0,
        },
        'option-1',
      ),
    ).toEqual([
      {
        addOnId: 'addon-1',
        quantity: 2,
      },
    ]);
  });

  it('adds selected paid add-ons to the checkout total', () => {
    expect(
      registrationAddonSelectedTotalPrice(
        addOns,
        {
          'addon-1': 2,
          'addon-2': 4,
        },
        'option-1',
      ),
    ).toBe(2000);
  });

  it('caps selectable add-ons by attached quantity and remaining stock', () => {
    expect(
      registrationAddonMaxSelectableQuantity(
        {
          maxQuantityPerUser: 5,
          registrationOptions: [
            {
              quantity: 2,
              registrationOptionId: 'option-1',
            },
          ],
          totalAvailableQuantity: 3,
        },
        'option-1',
      ),
    ).toBe(1);
  });
});

describe('registrationOptionWriteActionDisabled', () => {
  it('disables registration writes while register or waitlist mutations are pending', () => {
    expect(
      registrationOptionWriteActionDisabled({ mutationPending: true }),
    ).toBe(true);
  });

  it('allows registration writes while no register or waitlist mutation is pending', () => {
    expect(
      registrationOptionWriteActionDisabled({ mutationPending: false }),
    ).toBe(false);
  });

  it('disables registration writes while required answers are missing', () => {
    expect(
      registrationOptionWriteActionDisabled({
        missingRequiredAnswers: true,
        mutationPending: false,
      }),
    ).toBe(true);
  });
});

describe('registration question answers', () => {
  const option = {
    questions: [
      {
        description: null,
        id: 'question-1',
        required: true,
        sortOrder: 0,
        title: 'Emergency contact',
      },
      {
        description: null,
        id: 'question-2',
        required: false,
        sortOrder: 1,
        title: 'Dietary notes',
      },
    ],
  } as const;

  it('normalizes non-empty answers for the registration mutation payload', () => {
    expect(
      registrationQuestionAnswerPayload(option, {
        'question-1': '  Alice  ',
        'question-2': ' '.repeat(3),
      }),
    ).toEqual([
      {
        answer: 'Alice',
        questionId: 'question-1',
      },
    ]);
  });

  it('detects missing required answers', () => {
    expect(
      registrationQuestionsMissingRequired(option, {
        'question-1': ' '.repeat(3),
      }),
    ).toBe(true);
    expect(
      registrationQuestionsMissingRequired(option, {
        'question-1': 'Alice',
      }),
    ).toBe(false);
  });
});
