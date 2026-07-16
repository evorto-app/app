import type { EventGraphEditRecord } from '@shared/rpc-contracts/app-rpcs/events.rpcs';

import { describe, expect, it } from '@effect/vitest';
import { RpcBadRequestError } from '@shared/errors/rpc-errors';

import {
  type EventGraphUpdateInput,
  purchasedAddOnRegistrationOptionRemovalMessage,
  validateEventGraphStructure,
} from './event-graph.service';

const beforeGraph = (): EventGraphEditRecord => ({
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

const validInput = (): EventGraphUpdateInput => ({
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
    esnCardDiscountedPrice: option.esnCardDiscountedPrice,
    id: option.id,
    isPaid: option.isPaid,
    key: option.id,
    openRegistrationTime: option.openRegistrationTime,
    organizingRegistration: option.organizingRegistration,
    price: option.price,
    refundFeesOnCancellation: option.refundFeesOnCancellation,
    registeredDescription: option.registeredDescription,
    registrationMode:
      option.registrationMode === 'random' ? 'fcfs' : option.registrationMode,
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
      'An add-on that has already been purchased must remain available with its existing registration option',
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

  it('keeps a persisted legacy random event read-only when the payload changes it to fcfs', () => {
    const before = beforeGraph();
    before.registrationOptions = before.registrationOptions.map(
      (option, index) =>
        index === 1 ? { ...option, registrationMode: 'random' } : option,
    );
    const input = validInput();

    expect(
      input.registrationOptions.every(
        (option) => option.registrationMode !== 'random',
      ),
    ).toBe(true);
    const error = validateEventGraphStructure({ before, input });

    expect(error).toBeInstanceOf(RpcBadRequestError);
    expect(error).toMatchObject({
      _tag: 'RpcBadRequestError',
      reason: 'unsupportedEventRegistrationMode',
    });
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
      validateEventGraphStructure({ before: beforeGraph(), input })?.reason,
    ).toBe('simpleEventGraphRequiresTwoOptions');
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

  it('preserves every persisted option ID when switching a simple event to advanced mode', () => {
    const before = beforeGraph();
    const input = validInput();
    input.simpleModeEnabled = false;
    input.registrationOptions = input.registrationOptions.map((option) => ({
      ...option,
      id: undefined,
    }));

    expect(validateEventGraphStructure({ before, input })).toMatchObject({
      reason: 'eventModeTransitionMustPreserveOptionIds',
    });

    input.registrationOptions = validInput().registrationOptions;
    expect(validateEventGraphStructure({ before, input })).toBeNull();
  });

  it('requires the persisted advanced event to have the simple shape before conversion', () => {
    const before = beforeGraph();
    const participant = before.registrationOptions[1];
    if (!participant) throw new Error('Missing participant fixture');
    before.simpleModeEnabled = false;
    before.registrationOptions = [
      ...before.registrationOptions,
      { ...participant, id: 'option-guest', title: 'Guest' },
    ];
    const input = validInput();
    const guestInput = input.registrationOptions[1];
    if (!guestInput) throw new Error('Missing guest input fixture');
    input.registrationOptions.push({
      ...guestInput,
      id: 'option-guest',
      key: 'option-guest',
      title: 'Guest',
    });

    expect(validateEventGraphStructure({ before, input })).toMatchObject({
      reason: 'eventAdvancedToSimpleRequiresPersistedSimpleShape',
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
      validateEventGraphStructure({ before: beforeGraph(), input })?.reason,
    ).toBe('eventGraphIdMismatch');
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
      reason: 'paidEventAddonRequiresPositivePrice',
    });
  });
});
