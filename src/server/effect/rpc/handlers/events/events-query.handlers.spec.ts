import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import {
  eventListOrder,
  eventListUserSignUpState,
  eventOrganizeCapabilities,
  groupEventsByTenantDay,
  organizeOverviewAccessAllowed,
  organizerRegistrationApprovalState,
} from './events-query.handlers';

describe('eventListOrder', () => {
  it('uses event ID as the deterministic tie-breaker for offset paging', () => {
    const dialect = new PgDialect();

    expect(
      eventListOrder().map((order) => dialect.sqlToQuery(order).sql),
    ).toEqual(['"event_instances"."start" asc', '"event_instances"."id" asc']);
  });
});

describe('eventListUserSignUpState', () => {
  it('maps every valid active registration state', () => {
    expect(
      eventListUserSignUpState({
        hasPendingRegistrationTransaction: false,
        registrationId: 'confirmed-registration',
        registrationMode: 'fcfs',
        registrationStatus: 'CONFIRMED',
      }),
    ).toBe('confirmed');
    expect(
      eventListUserSignUpState({
        hasPendingRegistrationTransaction: false,
        registrationId: 'waitlist-registration',
        registrationMode: 'fcfs',
        registrationStatus: 'WAITLIST',
      }),
    ).toBe('waitlisted');
    expect(
      eventListUserSignUpState({
        hasPendingRegistrationTransaction: true,
        registrationId: 'payment-registration',
        registrationMode: 'fcfs',
        registrationStatus: 'PENDING',
      }),
    ).toBe('paymentRequired');
    expect(
      eventListUserSignUpState({
        hasPendingRegistrationTransaction: false,
        registrationId: 'application-registration',
        registrationMode: 'application',
        registrationStatus: 'PENDING',
      }),
    ).toBe('approvalPending');
  });

  it('fails loudly for a pending first-come-first-served registration without payment', () => {
    expect(() =>
      eventListUserSignUpState({
        hasPendingRegistrationTransaction: false,
        registrationId: 'registration-1',
        registrationMode: 'fcfs',
        registrationStatus: 'PENDING',
      }),
    ).toThrow(
      'Active registration registration-1 is pending in first-come-first-served mode without a pending registration payment',
    );
  });
});

describe('organizeOverviewAccessAllowed', () => {
  it('allows broad organizers and confirmed event organizers', () => {
    expect(
      organizeOverviewAccessAllowed({
        confirmedOrganizerRegistration: false,
        permissions: ['events:organizeAll'],
      }),
    ).toBe(true);
    expect(
      organizeOverviewAccessAllowed({
        confirmedOrganizerRegistration: true,
        permissions: [],
      }),
    ).toBe(true);
  });

  it('denies users without a broad permission or confirmed organizer registration', () => {
    expect(
      organizeOverviewAccessAllowed({
        confirmedOrganizerRegistration: false,
        permissions: [],
      }),
    ).toBe(false);
  });

  it('keeps receipt access separate from registration-management capabilities', () => {
    expect(
      eventOrganizeCapabilities({
        confirmedOrganizerRegistration: false,
        permissions: ['finance:manageReceipts'],
      }),
    ).toEqual({
      canApproveRegistrations: false,
      canCancelRegistrations: false,
      canTransferRegistrations: false,
      canViewOverview: true,
    });
  });

  it('requires the explicit cancellation permission even for confirmed organizers', () => {
    expect(
      eventOrganizeCapabilities({
        confirmedOrganizerRegistration: true,
        permissions: [],
      }),
    ).toEqual({
      canApproveRegistrations: true,
      canCancelRegistrations: false,
      canTransferRegistrations: true,
      canViewOverview: true,
    });
    expect(
      eventOrganizeCapabilities({
        confirmedOrganizerRegistration: true,
        permissions: ['events:cancelRegistrations'],
      }).canCancelRegistrations,
    ).toBe(true);
  });
});

describe('groupEventsByTenantDay', () => {
  it('groups instants by the tenant day instead of the server or viewer timezone', () => {
    const groups = groupEventsByTenantDay(
      [
        { id: 'event-1', start: '2026-01-01T23:30:00.000Z' },
        { id: 'event-2', start: '2026-01-02T22:30:00.000Z' },
      ],
      'Europe/Berlin',
    );

    expect(groups).toEqual([
      {
        day: '2026-01-01T23:00:00.000Z',
        events: [
          { id: 'event-1', start: '2026-01-01T23:30:00.000Z' },
          { id: 'event-2', start: '2026-01-02T22:30:00.000Z' },
        ],
      },
    ]);
  });

  it('returns the tenant midnight instant with daylight-saving offset applied', () => {
    const [group] = groupEventsByTenantDay(
      [{ id: 'event-1', start: '2026-07-10T12:00:00.000Z' }],
      'Europe/Berlin',
    );

    expect(group?.day).toBe('2026-07-09T22:00:00.000Z');
  });

  it('fails loudly when an internal event instant is invalid', () => {
    expect(() =>
      groupEventsByTenantDay([{ start: 'not-an-instant' }], 'Europe/Berlin'),
    ).toThrow('Invalid event start instant: not-an-instant');
  });
});

describe('organizerRegistrationApprovalState', () => {
  it('offers approval for a fresh pending application', () => {
    expect(
      organizerRegistrationApprovalState({
        registrationMode: 'application',
        registrationStatus: 'PENDING',
        transactions: [],
      }),
    ).toEqual({
      manualApprovalAvailable: true,
      paymentPending: false,
      paymentSetupRequired: false,
    });
  });

  it('offers payment setup recovery for a pending transaction without a Checkout session', () => {
    expect(
      organizerRegistrationApprovalState({
        registrationMode: 'application',
        registrationStatus: 'PENDING',
        transactions: [
          {
            status: 'pending',
            stripeCheckoutSessionId: null,
            type: 'registration',
          },
        ],
      }),
    ).toEqual({
      manualApprovalAvailable: true,
      paymentPending: true,
      paymentSetupRequired: true,
    });
  });

  it('hides approval after the pending transaction has a Checkout session', () => {
    expect(
      organizerRegistrationApprovalState({
        registrationMode: 'application',
        registrationStatus: 'PENDING',
        transactions: [
          {
            status: 'pending',
            stripeCheckoutSessionId: 'cs_test_123',
            type: 'registration',
          },
        ],
      }),
    ).toEqual({
      manualApprovalAvailable: false,
      paymentPending: true,
      paymentSetupRequired: false,
    });
  });

  it('ignores pending transactions unrelated to registration payment', () => {
    expect(
      organizerRegistrationApprovalState({
        registrationMode: 'application',
        registrationStatus: 'PENDING',
        transactions: [
          {
            status: 'pending',
            stripeCheckoutSessionId: null,
            type: 'refund',
          },
        ],
      }),
    ).toEqual({
      manualApprovalAvailable: true,
      paymentPending: false,
      paymentSetupRequired: false,
    });
  });
});
