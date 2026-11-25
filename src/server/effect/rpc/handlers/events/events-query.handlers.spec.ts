import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import {
  eventListOptionVisible,
  eventListOrder,
  type EventListSignUpOption,
  eventListSignUpSummary,
  eventListUserSignUpState,
  eventOrganizeCapabilities,
  eventRegistrationOptionsBypassEligibility,
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
        organizingRegistration: false,
        registrationId: 'confirmed-registration',
        registrationMode: 'fcfs',
        registrationStatus: 'CONFIRMED',
      }),
    ).toBe('confirmed');
    expect(
      eventListUserSignUpState({
        hasPendingRegistrationTransaction: false,
        organizingRegistration: false,
        registrationId: 'waitlist-registration',
        registrationMode: 'fcfs',
        registrationStatus: 'WAITLIST',
      }),
    ).toBe('waitlisted');
    expect(
      eventListUserSignUpState({
        hasPendingRegistrationTransaction: true,
        organizingRegistration: false,
        registrationId: 'payment-registration',
        registrationMode: 'fcfs',
        registrationStatus: 'PENDING',
      }),
    ).toBe('paymentRequired');
    expect(
      eventListUserSignUpState({
        hasPendingRegistrationTransaction: false,
        organizingRegistration: false,
        registrationId: 'application-registration',
        registrationMode: 'application',
        registrationStatus: 'PENDING',
      }),
    ).toBe('approvalPending');
  });

  it('distinguishes a confirmed event organizer from an attendee', () => {
    expect(
      eventListUserSignUpState({
        hasPendingRegistrationTransaction: false,
        organizingRegistration: true,
        registrationId: 'organizer-registration',
        registrationMode: 'fcfs',
        registrationStatus: 'CONFIRMED',
      }),
    ).toBe('organizerConfirmed');
  });

  it('fails loudly for a pending first-come-first-served registration without payment', () => {
    expect(() =>
      eventListUserSignUpState({
        hasPendingRegistrationTransaction: false,
        organizingRegistration: false,
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

  it('requires review without offering approval for a pending payment with no Checkout session', () => {
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
      manualApprovalAvailable: false,
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

const option = (
  overrides: Partial<EventListSignUpOption> = {},
): EventListSignUpOption => ({
  closeRegistrationTime: new Date('2026-07-14T10:00:00.000Z'),
  confirmedSpots: 0,
  openRegistrationTime: new Date('2026-07-01T10:00:00.000Z'),
  organizingRegistration: false,
  price: 0,
  reservedSpots: 0,
  roleIds: [],
  spots: 10,
  ...overrides,
});

const listNow = new Date('2026-07-06T00:00:00.000Z');

describe('eventListSignUpSummary', () => {
  it('returns null summaries without options', () => {
    expect(eventListSignUpSummary(listNow, [])).toEqual({
      organizerSlots: null,
      participantSignUp: null,
    });
  });

  it('summarizes organizer-only events without a participant summary', () => {
    expect(
      eventListSignUpSummary(listNow, [
        option({ confirmedSpots: 1, organizingRegistration: true, spots: 3 }),
      ]),
    ).toEqual({
      organizerSlots: { capacity: 3, filled: 1 },
      participantSignUp: null,
    });
  });

  it('keeps participant and organizer options apart', () => {
    const summary = eventListSignUpSummary(listNow, [
      option({ confirmedSpots: 4, reservedSpots: 1, spots: 10 }),
      option({
        confirmedSpots: 2,
        organizingRegistration: true,
        reservedSpots: 1,
        spots: 5,
      }),
    ]);
    expect(summary.participantSignUp).toMatchObject({
      exactSpots: { capacity: 10, spotsLeft: 5 },
      fillLevel: 'some',
    });
    expect(summary.organizerSlots).toEqual({ capacity: 5, filled: 3 });
  });

  it('reports a full event with zero spots left', () => {
    expect(
      eventListSignUpSummary(listNow, [
        option({ confirmedSpots: 8, reservedSpots: 2, spots: 10 }),
      ]).participantSignUp,
    ).toMatchObject({
      availability: 'full',
      exactSpots: null,
      fillLevel: null,
    });
  });

  it('never reports negative spots or overfilled organizer slots', () => {
    const summary = eventListSignUpSummary(listNow, [
      option({ confirmedSpots: 9, reservedSpots: 3, spots: 10 }),
      option({
        confirmedSpots: 9,
        organizingRegistration: true,
        reservedSpots: 3,
        spots: 10,
      }),
    ]);
    expect(summary.participantSignUp?.exactSpots).toEqual({
      capacity: 10,
      spotsLeft: 0,
    });
    expect(summary.participantSignUp?.availability).toBe('full');
    expect(summary.organizerSlots).toEqual({ capacity: 10, filled: 10 });
  });

  it('spans the price range, the earliest opening and the latest closing', () => {
    expect(
      eventListSignUpSummary(listNow, [
        option({
          closeRegistrationTime: new Date('2026-07-10T00:00:00.000Z'),
          openRegistrationTime: new Date('2026-07-05T00:00:00.000Z'),
          price: 1500,
          spots: 5,
        }),
        option({
          closeRegistrationTime: new Date('2026-07-12T00:00:00.000Z'),
          openRegistrationTime: new Date('2026-07-02T00:00:00.000Z'),
          price: 500,
          spots: 7,
        }),
      ]).participantSignUp,
    ).toEqual({
      availability: 'open',
      closesAt: '2026-07-12T00:00:00.000Z',
      exactSpots: null,
      fillLevel: 'many',
      highestPrice: 1500,
      lowestPrice: 500,
      opensAt: '2026-07-02T00:00:00.000Z',
    });
  });

  it('describes only the options open now, not a merged window', () => {
    const summary = eventListSignUpSummary(listNow, [
      option({
        closeRegistrationTime: new Date('2026-07-05T00:00:00.000Z'),
        openRegistrationTime: new Date('2026-07-01T00:00:00.000Z'),
        spots: 4,
      }),
      option({
        closeRegistrationTime: new Date('2026-07-10T00:00:00.000Z'),
        confirmedSpots: 3,
        openRegistrationTime: new Date('2026-07-02T00:00:00.000Z'),
        price: 800,
        spots: 3,
      }),
      option({
        closeRegistrationTime: new Date('2026-07-20T00:00:00.000Z'),
        openRegistrationTime: new Date('2026-07-15T00:00:00.000Z'),
        spots: 9,
      }),
    ]).participantSignUp;
    expect(summary).toEqual({
      availability: 'full',
      closesAt: '2026-07-10T00:00:00.000Z',
      exactSpots: null,
      fillLevel: null,
      highestPrice: 800,
      lowestPrice: 0,
      opensAt: '2026-07-02T00:00:00.000Z',
    });
  });

  it('describes the upcoming options when none is open', () => {
    expect(
      eventListSignUpSummary(listNow, [
        option({
          closeRegistrationTime: new Date('2026-07-05T00:00:00.000Z'),
          openRegistrationTime: new Date('2026-07-01T00:00:00.000Z'),
          spots: 4,
        }),
        option({
          closeRegistrationTime: new Date('2026-07-20T00:00:00.000Z'),
          openRegistrationTime: new Date('2026-07-15T00:00:00.000Z'),
          spots: 9,
        }),
      ]).participantSignUp,
    ).toMatchObject({
      availability: 'opens',
      closesAt: '2026-07-20T00:00:00.000Z',
      exactSpots: null,
      fillLevel: null,
      opensAt: '2026-07-15T00:00:00.000Z',
    });
  });

  it('keeps the last window when every option has closed', () => {
    expect(
      eventListSignUpSummary(listNow, [
        option({
          closeRegistrationTime: new Date('2026-07-03T00:00:00.000Z'),
          openRegistrationTime: new Date('2026-07-01T00:00:00.000Z'),
        }),
        option({
          closeRegistrationTime: new Date('2026-07-05T00:00:00.000Z'),
          openRegistrationTime: new Date('2026-07-02T00:00:00.000Z'),
        }),
      ]).participantSignUp,
    ).toMatchObject({
      availability: 'closed',
      closesAt: '2026-07-05T00:00:00.000Z',
      fillLevel: null,
      opensAt: '2026-07-01T00:00:00.000Z',
    });
  });

  describe('fillLevel', () => {
    const fillLevelFor = (confirmedSpots: number) =>
      eventListSignUpSummary(listNow, [option({ confirmedSpots, spots: 10 })])
        .participantSignUp?.fillLevel;

    it('is many below half full', () => {
      expect(fillLevelFor(0)).toBe('many');
      expect(fillLevelFor(4)).toBe('many');
    });

    it('is some from exactly half up to below 80 percent', () => {
      expect(fillLevelFor(5)).toBe('some');
      expect(fillLevelFor(7)).toBe('some');
    });

    it('is few from exactly 80 percent while a spot is left', () => {
      expect(fillLevelFor(8)).toBe('few');
      expect(fillLevelFor(9)).toBe('few');
    });

    it('is null when full, not yet open or closed', () => {
      expect(fillLevelFor(10)).toBeNull();
      expect(
        eventListSignUpSummary(listNow, [
          option({
            closeRegistrationTime: new Date('2026-07-20T00:00:00.000Z'),
            openRegistrationTime: new Date('2026-07-15T00:00:00.000Z'),
          }),
        ]).participantSignUp?.fillLevel,
      ).toBeNull();
      expect(
        eventListSignUpSummary(listNow, [
          option({
            closeRegistrationTime: new Date('2026-07-03T00:00:00.000Z'),
          }),
        ]).participantSignUp?.fillLevel,
      ).toBeNull();
    });

    it('counts reserved spots as taken', () => {
      expect(
        eventListSignUpSummary(listNow, [
          option({ confirmedSpots: 3, reservedSpots: 2, spots: 10 }),
        ]).participantSignUp?.fillLevel,
      ).toBe('some');
    });
  });

  describe('exactSpots', () => {
    it('is hidden from viewers without organizer options', () => {
      expect(
        eventListSignUpSummary(listNow, [option({ confirmedSpots: 2 })])
          .participantSignUp?.exactSpots,
      ).toBeNull();
    });

    it('is sent when the viewer sees an organizer option', () => {
      expect(
        eventListSignUpSummary(listNow, [
          option({ confirmedSpots: 2, reservedSpots: 1, spots: 10 }),
          option({ organizingRegistration: true, spots: 2 }),
        ]).participantSignUp?.exactSpots,
      ).toEqual({ capacity: 10, spotsLeft: 7 });
    });

    it('is sent for a full event to organizers and keeps availability full', () => {
      expect(
        eventListSignUpSummary(listNow, [
          option({ confirmedSpots: 10, spots: 10 }),
          option({ organizingRegistration: true, spots: 2 }),
        ]).participantSignUp,
      ).toMatchObject({
        availability: 'full',
        exactSpots: { capacity: 10, spotsLeft: 0 },
        fillLevel: null,
      });
    });
  });

  it('reports free events as 0 to 0', () => {
    expect(
      eventListSignUpSummary(listNow, [option()]).participantSignUp,
    ).toMatchObject({
      highestPrice: 0,
      lowestPrice: 0,
    });
  });
});

describe('eventListOptionVisible', () => {
  const visible = (
    roleIds: string[],
    viewer: { allowUnrestricted: boolean; bypass?: boolean; roles?: string[] },
  ) =>
    eventListOptionVisible({
      allowUnrestricted: viewer.allowUnrestricted,
      bypass: viewer.bypass ?? false,
      roleIds,
      viewerRoleIds: new Set(viewer.roles),
    });

  it('hides role-restricted options without the role and shows them with it', () => {
    expect(
      visible(['role-a'], { allowUnrestricted: true, roles: ['role-b'] }),
    ).toBe(false);
    expect(
      visible(['role-a'], { allowUnrestricted: true, roles: ['role-a'] }),
    ).toBe(true);
  });

  it('hides unrestricted options from anonymous viewers without a default role', () => {
    expect(visible([], { allowUnrestricted: false })).toBe(false);
    expect(visible([], { allowUnrestricted: true })).toBe(true);
  });

  it('shows every option to an editor of a draft event', () => {
    const bypass = eventRegistrationOptionsBypassEligibility({
      canEdit: true,
      canInspectAllTenantEvents: false,
      canReview: false,
      canSeeDrafts: false,
      status: 'DRAFT',
    });
    expect(bypass).toBe(true);
    expect(visible(['role-a'], { allowUnrestricted: true, bypass })).toBe(true);
  });
});
