import type { EventGraphEditRecord } from '@shared/rpc-contracts/app-rpcs/events.rpcs';

import { Database } from '@db/index';
import { describe, expect, it, layer } from '@effect/vitest';
import { createDatabaseTestLayer } from '@server/testing/database-test-layer';
import { RpcBadRequestError } from '@shared/errors/rpc-errors';
import {
  MAX_EVENT_ADDON_TYPES,
  MAX_REGISTRATION_ADDON_QUANTITY,
} from '@shared/registration-quantity-limits';
import {
  MAX_REGISTRATION_QUESTION_DESCRIPTION_LENGTH,
  MAX_REGISTRATION_QUESTION_TITLE_LENGTH,
  MAX_REGISTRATION_QUESTIONS,
} from '@shared/registration-question-limits';
import { EventsUpdateRpcError } from '@shared/rpc-contracts/app-rpcs/events.errors';
import { Effect, Schema } from 'effect';

import {
  type EventGraphUpdateInput,
  purchasedAddOnRegistrationOptionRemovalMessage,
  updateEventGraph,
  validateEventGraphStructure,
} from './event-graph.service';

type MutableFixture<T> = { -readonly [Key in keyof T]: MutableFixture<T[Key]> };

const beforeGraph = (): MutableFixture<EventGraphEditRecord> => ({
  addOns: [],
  description: '<p>Event description</p>',
  end: '2026-09-20T12:00:00.000Z',
  icon: { iconColor: 0, iconName: 'calendar:fas' },
  id: 'event-1',
  location: null,
  questions: [],
  registrationOptions: [
    {
      cancellationDeadlineHoursBeforeStart: null,
      closeRegistrationTime: '2026-09-19T12:00:00.000Z',
      description: null,
      esnCardDiscountedPrice: null,
      id: 'option-organizer',
      isPaid: false,
      openRegistrationTime: '2026-09-01T12:00:00.000Z',
      organizingRegistration: true,
      price: 0,
      refundFeesOnCancellation: null,
      registeredDescription: null,
      registrationMode: 'fcfs',
      roleIds: ['role-organizer'],
      spots: 2,
      stripeTaxRateId: null,
      title: 'Organizer',
      transferDeadlineHoursBeforeStart: null,
    },
    {
      cancellationDeadlineHoursBeforeStart: null,
      closeRegistrationTime: '2026-09-19T12:00:00.000Z',
      description: null,
      esnCardDiscountedPrice: null,
      id: 'option-participant',
      isPaid: false,
      openRegistrationTime: '2026-09-01T12:00:00.000Z',
      organizingRegistration: false,
      price: 0,
      refundFeesOnCancellation: null,
      registeredDescription: null,
      registrationMode: 'fcfs',
      roleIds: ['role-participant'],
      spots: 20,
      stripeTaxRateId: null,
      title: 'Participant',
      transferDeadlineHoursBeforeStart: null,
    },
  ],
  simpleModeEnabled: true,
  start: '2026-09-20T10:00:00.000Z',
  title: 'Event',
});

const validInput = (): MutableFixture<EventGraphUpdateInput> => ({
  addOns: [
    {
      allowMultiple: true,
      allowPurchaseBeforeEvent: true,
      allowPurchaseDuringEvent: false,
      allowPurchaseDuringRegistration: true,
      description: 'Reusable equipment',
      isPaid: false,
      key: 'addon-equipment',
      maxQuantityPerUser: 2,
      price: 0,
      registrationOptions: [
        {
          includedQuantity: 1,
          optionalPurchaseQuantity: 1,
          registrationOptionKey: 'option-participant',
        },
      ],
      stripeTaxRateId: null,
      title: 'Equipment',
      totalAvailableQuantity: 30,
    },
  ],
  description: '<p>Event description</p>',
  end: '2026-09-20T12:00:00.000Z',
  eventId: 'event-1',
  icon: { iconColor: 0, iconName: 'calendar:fas' },
  location: null,
  questions: [
    {
      description: null,
      key: 'question-dietary',
      registrationOptionKey: 'option-participant',
      required: false,
      sortOrder: 0,
      title: 'Dietary requirements',
    },
  ],
  registrationOptions: beforeGraph().registrationOptions.map((option) => ({
    cancellationDeadlineHoursBeforeStart:
      option.cancellationDeadlineHoursBeforeStart,
    closeRegistrationTime: option.closeRegistrationTime,
    description: option.description,
    esnCardDiscountedPrice: option.esnCardDiscountedPrice ?? null,
    id: option.id,
    isPaid: option.isPaid,
    key: option.id,
    openRegistrationTime: option.openRegistrationTime,
    organizingRegistration: option.organizingRegistration,
    price: option.price,
    refundFeesOnCancellation: option.refundFeesOnCancellation,
    registeredDescription: option.registeredDescription,
    registrationMode: option.registrationMode,
    roleIds: [...option.roleIds],
    spots: option.spots,
    stripeTaxRateId: option.stripeTaxRateId,
    title: option.title,
    transferDeadlineHoursBeforeStart: option.transferDeadlineHoursBeforeStart,
  })),
  simpleModeEnabled: true,
  start: '2026-09-20T10:00:00.000Z',
  title: 'Event',
});

describe('event graph structural validation', () => {
  it('explains why a purchased add-on must keep its registration option', () => {
    expect(purchasedAddOnRegistrationOptionRemovalMessage).toBe(
      'An add-on that has already been bought must remain available with its current sign-up choice.',
    );
  });

  it('accepts simple mode with exactly one option of each kind', () => {
    expect(
      validateEventGraphStructure({
        before: beforeGraph(),
        input: validInput(),
      }),
    ).toBeNull();
  });

  it('preserves first-come and manual-approval modes in simple and advanced graphs', () => {
    for (const simpleModeEnabled of [true, false]) {
      const before = beforeGraph();
      before.simpleModeEnabled = simpleModeEnabled;
      before.registrationOptions = before.registrationOptions.map(
        (option, index) =>
          index === 1 ? { ...option, registrationMode: 'application' } : option,
      );
      const input = validInput();
      input.simpleModeEnabled = simpleModeEnabled;
      input.registrationOptions = input.registrationOptions.map(
        (option, index) =>
          index === 1 ? { ...option, registrationMode: 'application' } : option,
      );

      expect(validateEventGraphStructure({ before, input })).toBeNull();
      expect(
        before.registrationOptions.map((option) => option.registrationMode),
      ).toEqual(['fcfs', 'application']);
      expect(
        input.registrationOptions.map((option) => option.registrationMode),
      ).toEqual(['fcfs', 'application']);
    }
  });

  it('rejects simple mode with an extra registration option', () => {
    const input = validInput();
    const participantOption = input.registrationOptions[1];
    if (!participantOption) throw new Error('Missing participant fixture');
    input.registrationOptions.push({
      ...participantOption,
      id: undefined,
      key: 'option-guest',
      title: 'Guest',
    });

    expect(
      validateEventGraphStructure({ before: beforeGraph(), input }),
    ).toMatchObject({
      message:
        'Simple setup needs exactly one organizer choice and one attendee choice.',
      reason: 'simpleEventGraphRequiresTwoOptions',
    });
  });

  it('allows optionless and category-missing advanced events', () => {
    const before = beforeGraph();
    before.simpleModeEnabled = false;
    const input = validInput();
    input.simpleModeEnabled = false;
    input.registrationOptions = [];
    input.addOns = [];
    input.questions = [];

    expect(validateEventGraphStructure({ before, input })).toBeNull();
  });

  it('allows choices to be replaced while switching to advanced setup in one save', () => {
    const before = beforeGraph();
    const input = validInput();
    input.simpleModeEnabled = false;
    input.registrationOptions = input.registrationOptions.map((option) => ({
      ...option,
      id: undefined,
    }));

    expect(validateEventGraphStructure({ before, input })).toBeNull();

    input.registrationOptions = validInput().registrationOptions;
    expect(validateEventGraphStructure({ before, input })).toBeNull();
  });

  it('allows extra advanced choices to be removed while switching to simple setup in one save', () => {
    const before = beforeGraph();
    const participant = before.registrationOptions[1];
    if (!participant) throw new Error('Missing participant fixture');
    before.simpleModeEnabled = false;
    before.registrationOptions = [
      ...before.registrationOptions,
      { ...participant, id: 'option-guest', title: 'Guest' },
    ];
    const input = validInput();
    expect(validateEventGraphStructure({ before, input })).toBeNull();
    const guestInput = input.registrationOptions[1];
    if (!guestInput) throw new Error('Missing guest input fixture');
    input.registrationOptions.push({
      ...guestInput,
      id: 'option-guest',
      key: 'option-guest',
      title: 'Guest',
    });

    expect(validateEventGraphStructure({ before, input })).toMatchObject({
      reason: 'simpleEventGraphRequiresTwoOptions',
    });
  });

  it('allows a persisted two-option advanced event to switch to simple without replacing IDs', () => {
    const before = beforeGraph();
    before.simpleModeEnabled = false;

    expect(
      validateEventGraphStructure({ before, input: validInput() }),
    ).toBeNull();
  });

  it('rejects persisted child IDs from another event', () => {
    const input = validInput();
    const organizerOption = input.registrationOptions[0];
    if (!organizerOption) throw new Error('Missing organizer fixture');
    input.registrationOptions[0] = {
      ...organizerOption,
      id: 'foreign-option',
    };

    expect(
      validateEventGraphStructure({ before: beforeGraph(), input }),
    ).toMatchObject({
      message:
        'Some event details changed while this page was open. Nothing was saved. Reopen the event and review the current details before making your changes again.',
      reason: 'eventGraphIdMismatch',
    });
  });

  it('accepts one add-on mapped to multiple options in advanced mode', () => {
    const input = validInput();
    input.simpleModeEnabled = false;
    const addOn = input.addOns[0];
    if (!addOn) throw new Error('Missing add-on fixture');
    addOn.registrationOptions.push({
      includedQuantity: 1,
      optionalPurchaseQuantity: 0,
      registrationOptionKey: 'option-organizer',
    });

    expect(
      validateEventGraphStructure({ before: beforeGraph(), input }),
    ).toBeNull();
  });

  it('rejects a paid registration option with a zero price as a typed bad request', () => {
    const input = validInput();
    const participantOption = input.registrationOptions[1];
    if (!participantOption) throw new Error('Missing participant fixture');
    input.registrationOptions[1] = {
      ...participantOption,
      isPaid: true,
      price: 0,
    };

    const error = validateEventGraphStructure({ before: beforeGraph(), input });

    expect(error).toBeInstanceOf(RpcBadRequestError);
    expect(error).toMatchObject({
      _tag: 'RpcBadRequestError',
      message: 'Paid event registration options require a positive price',
      reason: 'paidEventRegistrationOptionRequiresPositivePrice',
    });
  });

  it('rejects a paid add-on with a zero price as a typed bad request', () => {
    const input = validInput();
    const addOn = input.addOns[0];
    if (!addOn) throw new Error('Missing add-on fixture');
    input.addOns[0] = {
      ...addOn,
      isPaid: true,
      price: 0,
    };

    const error = validateEventGraphStructure({ before: beforeGraph(), input });

    expect(error).toBeInstanceOf(RpcBadRequestError);
    expect(error).toMatchObject({
      _tag: 'RpcBadRequestError',
      message: 'Enter a price greater than zero for each paid add-on.',
      reason: 'paidEventAddonRequiresPositivePrice',
    });
  });

  it('accepts the add-on type cap and rejects cap plus one', () => {
    const input = validInput();
    const addOn = input.addOns[0];
    if (!addOn) throw new Error('Missing add-on fixture');
    input.addOns = Array.from(
      { length: MAX_EVENT_ADDON_TYPES },
      (_, index) => ({
        ...addOn,
        key: `addon-${index}`,
      }),
    );

    expect(
      validateEventGraphStructure({ before: beforeGraph(), input }),
    ).toBeNull();
    input.addOns.push({ ...addOn, key: 'addon-over-limit' });
    expect(
      validateEventGraphStructure({ before: beforeGraph(), input }),
    ).toMatchObject({ reason: 'eventAddonTypeLimitExceeded' });
  });

  it('rejects a mapped add-on quantity above the per-registration cap', () => {
    const input = validInput();
    const addOn = input.addOns[0];
    if (!addOn) throw new Error('Missing add-on fixture');
    addOn.maxQuantityPerUser = MAX_REGISTRATION_ADDON_QUANTITY;
    addOn.registrationOptions = [
      {
        includedQuantity: MAX_REGISTRATION_ADDON_QUANTITY,
        optionalPurchaseQuantity: 1,
        registrationOptionKey: 'option-participant',
      },
    ];

    expect(
      validateEventGraphStructure({ before: beforeGraph(), input }),
    ).toMatchObject({ reason: 'invalidEventAddon' });
  });
});

describe('event question input bounds', () => {
  it('accepts exact count and raw text caps and rejects cap plus one', () => {
    const input = validInput();
    const question = {
      ...input.questions[0],
      description: 'd'.repeat(MAX_REGISTRATION_QUESTION_DESCRIPTION_LENGTH),
      title: 't'.repeat(MAX_REGISTRATION_QUESTION_TITLE_LENGTH),
    };
    const questions = Array.from(
      { length: MAX_REGISTRATION_QUESTIONS },
      (_, index) => ({ ...question, key: `question-${index}` }),
    );
    expect(
      validateEventGraphStructure({
        before: beforeGraph(),
        input: { ...input, questions },
      }),
    ).toBeNull();
    expect(
      validateEventGraphStructure({
        before: beforeGraph(),
        input: {
          ...input,
          questions: [...questions, { ...question, key: 'question-overflow' }],
        },
      }),
    ).toBeInstanceOf(RpcBadRequestError);
    expect(
      validateEventGraphStructure({
        before: beforeGraph(),
        input: {
          ...input,
          questions: [{ ...question, title: ` ${question.title}` }],
        },
      }),
    ).toBeInstanceOf(RpcBadRequestError);
    expect(
      validateEventGraphStructure({
        before: beforeGraph(),
        input: {
          ...input,
          questions: [{ ...question, description: `${question.description} ` }],
        },
      }),
    ).toBeInstanceOf(RpcBadRequestError);
  });
});

layer(createDatabaseTestLayer())('event graph price validation', (it) => {
  for (const pair of [
    {
      isPaid: true,
      price: 0,
      reason: 'paidEventRegistrationOptionRequiresPositivePrice',
    },
    {
      isPaid: false,
      price: 100,
      reason: 'freeEventRegistrationOptionRequiresZeroPrice',
    },
  ]) {
    it.effect(
      `rejects isPaid=${pair.isPaid}, price=${pair.price} before database access`,
      () =>
        Effect.gen(function* () {
          const input = validInput();
          input.registrationOptions = input.registrationOptions.map(
            (option, index) =>
              index === 1
                ? { ...option, isPaid: pair.isPaid, price: pair.price }
                : option,
          );
          const error = yield* updateEventGraph({
            before: beforeGraph(),
            database: yield* Database,
            esnCardEnabled: false,
            input,
            tenantId: 'tenant-1',
          }).pipe(Effect.flip);

          expect(error).toBeInstanceOf(RpcBadRequestError);
          expect(error).toMatchObject({
            _tag: 'RpcBadRequestError',
            reason: pair.reason,
          });
          expect(Schema.is(EventsUpdateRpcError)(error)).toBe(true);
          expect(input.registrationOptions[1]?.price).toBe(pair.price);
        }),
    );
  }
});
