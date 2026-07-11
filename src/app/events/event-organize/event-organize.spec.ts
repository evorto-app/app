import { readFileSync } from 'node:fs';
import nodePath from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  computeEventOrganizeStats,
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
  it('sums capacity, confirmed registrations, and scanner-updated checked-in spots', () => {
    expect(
      computeEventOrganizeStats({
        registrationOptions: [
          {
            checkedInSpots: 3,
            confirmedSpots: 5,
            spots: 10,
          },
          {
            checkedInSpots: 2,
            confirmedSpots: 4,
            spots: 8,
          },
        ],
      }),
    ).toEqual({
      capacity: 18,
      capacityPercentage: 0.5,
      checkedIn: 5,
      registered: 9,
    });
  });

  it('keeps empty organizer stats stable before the event query resolves', () => {
    expect(computeEventOrganizeStats()).toEqual({
      capacity: 0,
      capacityPercentage: 0,
      checkedIn: 0,
      registered: 0,
    });
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
  it('blocks organizer transfer for checked-in, paid, or in-flight rows', () => {
    expect(
      organizerRegistrationTransferDisabled({
        checkedIn: true,
        mutationPending: false,
        transferAvailable: true,
      }),
    ).toBe(true);
    expect(
      organizerRegistrationTransferDisabled({
        checkedIn: false,
        mutationPending: true,
        transferAvailable: true,
      }),
    ).toBe(true);
    expect(
      organizerRegistrationTransferDisabled({
        checkedIn: false,
        mutationPending: false,
        transferAvailable: false,
      }),
    ).toBe(true);
    expect(
      organizerRegistrationTransferDisabled({
        checkedIn: false,
        mutationPending: false,
        transferAvailable: true,
      }),
    ).toBe(false);
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
  it('only renders available approval actions and exposes the in-flight row state', () => {
    const template = readSource(
      'src/app/events/event-organize/event-organize.html',
    );

    expect(template).toContain('@if (user.manualApprovalAvailable)');
    expect(template).not.toContain('@if (user.status === "PENDING")');
    expect(template).toContain('[attr.aria-busy]="approvalInFlight || null"');
    expect(template).toContain('Payment setup needs retry');
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
