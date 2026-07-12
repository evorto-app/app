import { QueryClient } from '@tanstack/angular-query-experimental';
import { readFileSync } from 'node:fs';
import nodePath from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  computeEventOrganizeStats,
  groupEventOrganizeRegistrationOptions,
  invalidateEventOrganizeStateQueries,
  organizerRegistrationActionDisabled,
  organizerRegistrationApprovalDisabled,
  organizerRegistrationApprovalLabel,
  organizerRegistrationTransferDisabled,
  receiptSubmissionActionDisabled,
} from './event-organize';
import { transferParticipantLabel } from './registration-transfer-dialog.component';

const readSource = (sourcePath: string): string =>
  readFileSync(nodePath.join(process.cwd(), sourcePath), 'utf8');

describe('computeEventOrganizeStats', () => {
  it('uses the server-provided unfiltered aggregates for organizer statistics', () => {
    expect(
      computeEventOrganizeStats({
        capacity: 18,
        checkedIn: 5,
        registered: 9,
      }),
    ).toEqual({
      capacity: 18,
      capacityPercentage: 0.5,
      checkedIn: 5,
      registered: 9,
    });
  });

  it('keeps empty organizer stats stable before the overview query resolves', () => {
    expect(computeEventOrganizeStats()).toEqual({
      capacity: 0,
      capacityPercentage: 0,
      checkedIn: 0,
      registered: 0,
    });
  });
});

describe('invalidateEventOrganizeStateQueries', () => {
  it('invalidates every exact self-facing cache after an organizer action', async () => {
    const queryClient = new QueryClient();
    const queryKeys = {
      eventDetails: ['events', 'findOne', 'event-1'],
      organizerAccess: ['events', 'canOrganize', 'event-1'],
      organizerOverview: ['events', 'getOrganizeOverview', 'event-1'],
      registrationStatus: ['events', 'getRegistrationStatus', 'event-1'],
      scannerAccess: ['users', 'canUseScanner'],
      userEvents: ['users', 'events'],
    } as const;
    const exactQueryKeys = Object.values(queryKeys);
    const nestedOverviewKey = [...queryKeys.organizerOverview, 'nested'];

    for (const queryKey of [...exactQueryKeys, nestedOverviewKey]) {
      queryClient.setQueryData(queryKey, 'stale');
    }

    await invalidateEventOrganizeStateQueries(queryClient, queryKeys);

    for (const queryKey of exactQueryKeys) {
      expect(queryClient.getQueryState(queryKey)?.isInvalidated).toBe(true);
    }
    expect(queryClient.getQueryState(nestedOverviewKey)?.isInvalidated).toBe(
      false,
    );
  });

  it('maps the helper to the complete organizer self-action RPC cache set', () => {
    const source = readSource(
      'src/app/events/event-organize/event-organize.ts',
    );

    for (const queryKeyBuilder of [
      'this.rpc.events.getOrganizeOverview.queryKey',
      'this.rpc.events.findOne.queryKey',
      'this.rpc.events.getRegistrationStatus.queryKey',
      'this.rpc.events.canOrganize.queryKey',
      'this.rpc.users.canUseScanner.queryKey',
      'this.rpc.users.events.queryKey',
    ]) {
      expect(source).toContain(queryKeyBuilder);
    }
    expect(source).toContain(
      'return invalidateEventOrganizeStateQueries(this.queryClient',
    );
    expect(
      source.match(/await this\.invalidateOrganizerState\(\)/g),
    ).toHaveLength(4);
  });
});

describe('groupEventOrganizeRegistrationOptions', () => {
  it('separates the organizer/helper team from participant registrations without changing option order', () => {
    const organizerOption = {
      id: 'organizer-option',
      organizingRegistration: true,
    };
    const participantOptionA = {
      id: 'participant-option-a',
      organizingRegistration: false,
    };
    const participantOptionB = {
      id: 'participant-option-b',
      organizingRegistration: false,
    };

    const groups = groupEventOrganizeRegistrationOptions([
      participantOptionA,
      organizerOption,
      participantOptionB,
    ]);

    expect(groups).toEqual([
      {
        emptyMessage: 'No organizer/helper registrations yet.',
        id: 'organizer-helper-team',
        options: [organizerOption],
        title: 'Organizer/helper team',
      },
      {
        emptyMessage: 'No participant registrations yet.',
        id: 'participant-registrations',
        options: [participantOptionA, participantOptionB],
        title: 'Participant registrations',
      },
    ]);
  });
});

describe('transferParticipantLabel', () => {
  it('shows the participant identity before organizer-assisted transfer', () => {
    expect(
      transferParticipantLabel({
        email: 'alex@example.com',
        firstName: 'Alex',
        lastName: 'Able',
      }),
    ).toBe('Alex Able (alex@example.com)');
  });
});

describe('organizerRegistrationActionDisabled', () => {
  it('blocks organizer participant mutations for checked-in rows or in-flight writes', () => {
    expect(
      organizerRegistrationActionDisabled({
        checkedIn: true,
        mutationPending: false,
      }),
    ).toBe(true);
    expect(
      organizerRegistrationActionDisabled({
        checkedIn: false,
        mutationPending: true,
      }),
    ).toBe(true);
    expect(
      organizerRegistrationActionDisabled({
        checkedIn: false,
        mutationPending: false,
      }),
    ).toBe(false);
  });
});

describe('organizerRegistrationTransferDisabled', () => {
  it('allows confirmed rows into authoritative review regardless of prior fulfillment or payment history', () => {
    expect(
      organizerRegistrationTransferDisabled({
        mutationPending: false,
        status: 'CONFIRMED',
      }),
    ).toBe(false);
    expect(
      organizerRegistrationTransferDisabled({
        mutationPending: true,
        status: 'CONFIRMED',
      }),
    ).toBe(true);
    expect(
      organizerRegistrationTransferDisabled({
        mutationPending: false,
        status: 'PENDING',
      }),
    ).toBe(true);
    expect(
      organizerRegistrationTransferDisabled({
        mutationPending: false,
        status: 'WAITLIST',
      }),
    ).toBe(true);
  });
});

describe('organizerRegistrationApprovalDisabled', () => {
  it('blocks approval unless the row is an available manual application and no write is pending', () => {
    expect(
      organizerRegistrationApprovalDisabled({
        manualApprovalAvailable: false,
        mutationPending: false,
      }),
    ).toBe(true);
    expect(
      organizerRegistrationApprovalDisabled({
        manualApprovalAvailable: true,
        mutationPending: true,
      }),
    ).toBe(true);
    expect(
      organizerRegistrationApprovalDisabled({
        manualApprovalAvailable: true,
        mutationPending: false,
      }),
    ).toBe(false);
  });
});

describe('organizerRegistrationApprovalLabel', () => {
  it('distinguishes fresh approval from payment setup recovery', () => {
    expect(
      organizerRegistrationApprovalLabel({
        approvalPending: false,
        paymentSetupRequired: false,
      }),
    ).toBe('Approve application');
    expect(
      organizerRegistrationApprovalLabel({
        approvalPending: false,
        paymentSetupRequired: true,
      }),
    ).toBe('Retry payment setup');
  });

  it('shows the in-flight state for either approval action', () => {
    for (const paymentSetupRequired of [false, true]) {
      expect(
        organizerRegistrationApprovalLabel({
          approvalPending: true,
          paymentSetupRequired,
        }),
      ).toBe('Approving…');
    }
  });
});

describe('event organizer approval template', () => {
  it('renders organizer/helper approval only when the server grants approval access', () => {
    const template = readSource(
      'src/app/events/event-organize/event-organize.html',
    );

    expect(template).toContain('registrationOption.canApproveRegistrations &&');
    expect(template).toContain('user.manualApprovalAvailable');
    expect(template).not.toContain('@if (user.status === "PENDING")');
    expect(template).not.toContain(
      '@if (!registrationOption.organizingRegistration)',
    );
    expect(template).toContain('[attr.aria-busy]="approvalInFlight || null"');
    expect(template).toContain('Payment setup needs retry');
  });

  it('hides transfer and cancellation actions unless their server capabilities are present', () => {
    const template = readSource(
      'src/app/events/event-organize/event-organize.html',
    );

    expect(template).toContain(
      '@if (registrationOption.canTransferRegistrations)',
    );
    expect(template).toContain(
      '@if (registrationOption.canCancelRegistrations)',
    );
  });
});

describe('event organizer overview structure', () => {
  it('uses semantic registration groups and a compact responsive definition list', () => {
    const template = readSource(
      'src/app/events/event-organize/event-organize.html',
    );

    expect(template).toContain(
      '@for (group of registrationGroups(); track group.id)',
    );
    expect(template).toContain('[attr.aria-labelledby]="group.id"');
    expect(template).toContain('<dl');
    expect(template).toContain('<dt');
    expect(template).toContain('<dd');
    expect(template).toContain('@sm:grid-cols-3');
    expect(template).not.toContain('<!-- Quick Stats Cards -->');
  });
});

describe('event organizer query-state template', () => {
  it('hides operational counts and actions until their queries succeed', () => {
    const template = readSource(
      'src/app/events/event-organize/event-organize.html',
    );

    expect(template).toContain('aria-label="Back to event"');
    expect(template).toContain('@if (eventQuery.isPending())');
    expect(template).toContain('@else if (eventQuery.isError())');
    expect(template).toContain('@else if (organizerOverviewQuery.isSuccess())');
    expect(template).toContain('Participant data could not be loaded');
    expect(template).toContain(
      'not treat the missing counts as zero or as current event data',
    );
    expect(template).toContain('(click)="organizerOverviewQuery.refetch()"');
    expect(template).toContain('(click)="receiptsByEventQuery.refetch()"');

    const source = readSource(
      'src/app/events/event-organize/event-organize.ts',
    );
    expect(source).toContain('if (!this.receiptsByEventQuery.isSuccess())');
    expect(source).toContain(
      'Receipt history must load before a receipt can be added.',
    );
  });

  it('binds organizer cancellation to the confirmed participant state', () => {
    const source = readSource(
      'src/app/events/event-organize/event-organize.ts',
    );

    expect(source).toContain(
      'const expectedPaymentPending = registration.paymentPending',
    );
    expect(source).toContain('const expectedStatus = registration.status');
  });
});

describe('receiptSubmissionActionDisabled', () => {
  it('blocks receipt submission while unavailable, uploading, or submitting', () => {
    expect(
      receiptSubmissionActionDisabled({
        submissionUnavailable: true,
        submitPending: false,
        uploadPending: false,
      }),
    ).toBe(true);
    expect(
      receiptSubmissionActionDisabled({
        submissionUnavailable: false,
        submitPending: false,
        uploadPending: true,
      }),
    ).toBe(true);
    expect(
      receiptSubmissionActionDisabled({
        submissionUnavailable: false,
        submitPending: true,
        uploadPending: false,
      }),
    ).toBe(true);
    expect(
      receiptSubmissionActionDisabled({
        submissionUnavailable: false,
        submitPending: false,
        uploadPending: false,
      }),
    ).toBe(false);
  });
});
