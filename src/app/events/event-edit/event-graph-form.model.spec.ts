import type { EventGraphEditRecord } from '@shared/rpc-contracts/app-rpcs/events.rpcs';

import { describe, expect, it } from 'vitest';

import { DEFAULT_TENANT_TIMEZONE } from '../../../types/custom/tenant';
import {
  advancedEventGraphWarnings,
  eventGraphFormToPayload,
  eventGraphRecordToFormModel,
  legacyRandomEventEditMessage,
  simpleEventGraphIssue,
} from './event-graph-form.model';

const registrationOption = ({
  id,
  organizingRegistration,
}: {
  id: string;
  organizingRegistration: boolean;
}): EventGraphEditRecord['registrationOptions'][number] => ({
  cancellationDeadlineHoursBeforeStart: null,
  closeRegistrationTime: '2027-01-09T12:00:00.000Z',
  description: null,
  esnCardDiscountedPrice: null,
  id,
  isPaid: false,
  openRegistrationTime: '2026-12-01T12:00:00.000Z',
  organizingRegistration,
  price: 0,
  refundFeesOnCancellation: null,
  registeredDescription: null,
  registrationMode: 'fcfs',
  roleIds: [`role-${id}`],
  spots: organizingRegistration ? 2 : 20,
  stripeTaxRateId: null,
  title: organizingRegistration ? 'Organizers' : 'Participants',
  transferDeadlineHoursBeforeStart: null,
});

const eventGraph = (): EventGraphEditRecord => ({
  addOns: [
    {
      allowMultiple: true,
      allowPurchaseBeforeEvent: false,
      allowPurchaseDuringEvent: false,
      allowPurchaseDuringRegistration: true,
      description: 'Event shirt',
      id: 'addon-1',
      isPaid: false,
      maxQuantityPerUser: 2,
      price: 0,
      registrationOptions: [
        {
          includedQuantity: 1,
          optionalPurchaseQuantity: 2,
          registrationOptionId: 'participant-option',
        },
        {
          includedQuantity: 1,
          optionalPurchaseQuantity: 0,
          registrationOptionId: 'organizer-option',
        },
      ],
      stripeTaxRateId: null,
      title: 'Shirt',
      totalAvailableQuantity: 50,
    },
  ],
  description: 'Event description',
  end: '2027-01-10T18:00:00.000Z',
  icon: { iconColor: 0, iconName: 'calendar:fas' },
  id: 'event-1',
  location: null,
  questions: [
    {
      description: null,
      id: 'question-1',
      registrationOptionId: 'participant-option',
      required: true,
      sortOrder: 0,
      title: 'Dietary requirements?',
    },
  ],
  registrationOptions: [
    registrationOption({
      id: 'organizer-option',
      organizingRegistration: true,
    }),
    registrationOption({
      id: 'participant-option',
      organizingRegistration: false,
    }),
  ],
  simpleModeEnabled: true,
  start: '2027-01-10T12:00:00.000Z',
  title: 'Event',
});

describe('event graph form mapping', () => {
  it('preserves stable option references and distinct add-on quantities', () => {
    const loadResult = eventGraphRecordToFormModel(
      eventGraph(),
      DEFAULT_TENANT_TIMEZONE,
    );
    expect('model' in loadResult).toBe(true);
    if (!('model' in loadResult)) return;

    expect(loadResult.model.addOns[0]?.registrationOptions).toEqual([
      {
        includedQuantity: 1,
        optionalPurchaseQuantity: 2,
        registrationOptionKey: 'participant-option',
      },
      {
        includedQuantity: 1,
        optionalPurchaseQuantity: 0,
        registrationOptionKey: 'organizer-option',
      },
    ]);

    const payloadResult = eventGraphFormToPayload(loadResult.model, false);
    expect('payload' in payloadResult).toBe(true);
    if (!('payload' in payloadResult)) return;
    expect(payloadResult.payload.addOns[0]?.registrationOptions).toEqual(
      loadResult.model.addOns[0]?.registrationOptions,
    );
    expect(payloadResult.payload.questions[0]).toMatchObject({
      id: 'question-1',
      registrationOptionKey: 'participant-option',
    });
  });

  it('blocks legacy random allocation without coercing it', () => {
    const source = eventGraph();
    const result = eventGraphRecordToFormModel(
      {
        ...source,
        registrationOptions: source.registrationOptions.map((option, index) =>
          index === 1 ? { ...option, registrationMode: 'random' } : option,
        ),
      },
      DEFAULT_TENANT_TIMEZONE,
    );
    expect(result).toEqual({ error: legacyRandomEventEditMessage });
  });

  it('enforces simple compatibility while advanced category gaps remain warnings', () => {
    const options = [
      { organizingRegistration: true },
      { organizingRegistration: false },
    ];
    expect(simpleEventGraphIssue(options)).toBeNull();
    expect(
      simpleEventGraphIssue([...options, { organizingRegistration: false }]),
    ).toContain('exactly one');
    expect(advancedEventGraphWarnings([])).toEqual([
      'No organizing registration option is configured.',
      'No non-organizing registration option is configured.',
    ]);
    expect(
      advancedEventGraphWarnings([
        { organizingRegistration: true },
        { organizingRegistration: true },
      ]),
    ).toEqual(['No non-organizing registration option is configured.']);
  });
});
