import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';

import { createEventFormModelFromTemplate } from './template-create-event.mapper';

describe('createEventFormModelFromTemplate', () => {
  it('copies reusable event and registration defaults into the event form', () => {
    const start = DateTime.fromISO('2026-06-01T18:00:00.000Z', {
      zone: 'utc',
    });

    const model = createEventFormModelFromTemplate(
      {
        addOns: [],
        categoryId: 'category-1',
        description: '<p>Template description</p>',
        icon: {
          iconColor: 2,
          iconName: 'calendar:fas',
        },
        id: 'template-1',
        location: {
          meetingProvider: 'zoom',
          meetingUrl: 'https://example.test/meeting',
          name: 'Online room',
          type: 'online',
        },
        planningTips: 'Bring printed waiver forms.',
        registrationOptions: [
          {
            closeRegistrationOffset: 24,
            description: '<p>Public participant copy</p>',
            esnCardDiscountedPrice: 1200,
            id: 'template-option-1',
            isPaid: true,
            openRegistrationOffset: 168,
            organizingRegistration: false,
            price: 1500,
            registeredDescription: '<p>Attendee details</p>',
            registrationMode: 'fcfs',
            roleIds: ['role-user'],
            roles: [{ id: 'role-user', name: 'User' }],
            spots: 40,
            stripeTaxRateId: 'txr_123',
            title: 'Participant',
          },
        ],
        title: 'Weekly meetup',
      },
      start,
    );

    expect(model).toMatchObject({
      description: '<p>Template description</p>',
      icon: {
        iconColor: 2,
        iconName: 'calendar:fas',
      },
      location: {
        meetingProvider: 'zoom',
        meetingUrl: 'https://example.test/meeting',
        name: 'Online room',
        type: 'online',
      },
      title: 'Weekly meetup',
    });
    expect(model.start.toISO()).toBe('2026-06-01T18:00:00.000Z');
    expect(model.end.toISO()).toBe('2026-06-01T18:00:00.000Z');
    expect(model.registrationOptions).toHaveLength(1);
    expect(model.registrationOptions[0]).toMatchObject({
      description: '<p>Public participant copy</p>',
      id: 'template-option-1',
      isPaid: true,
      organizingRegistration: false,
      price: 1500,
      registeredDescription: '<p>Attendee details</p>',
      registrationMode: 'fcfs',
      roleIds: ['role-user'],
      spots: 40,
      stripeTaxRateId: 'txr_123',
      title: 'Participant',
    });
    expect(model.registrationOptions[0]?.openRegistrationTime.toISO()).toBe(
      '2026-05-25T18:00:00.000Z',
    );
    expect(model.registrationOptions[0]?.closeRegistrationTime.toISO()).toBe(
      '2026-05-31T18:00:00.000Z',
    );
  });

  it('keeps organizer planning tips private to the template surface', () => {
    const model = createEventFormModelFromTemplate(
      {
        addOns: [],
        categoryId: 'category-1',
        description: '<p>Template description</p>',
        icon: {
          iconColor: 2,
          iconName: 'calendar:fas',
        },
        id: 'template-1',
        location: null,
        planningTips: 'Bring printed waiver forms.',
        registrationOptions: [],
        title: 'Weekly meetup',
      },
      DateTime.fromISO('2026-06-01T18:00:00.000Z', { zone: 'utc' }),
    );

    expect('planningTips' in model).toBe(false);
    expect(model.description).toBe('<p>Template description</p>');
  });
});
