import { readFileSync } from 'node:fs';
import nodePath from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  computeEventOrganizeStats,
  organizerRegistrationActionDisabled,
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

describe('event organize participants query state', () => {
  it('guards participant rows behind loaded organizer overview data', () => {
    const template = readSource(
      'src/app/events/event-organize/event-organize.html',
    );
    const participantSection = template.slice(
      template.indexOf('<h2 class="title-large">Participants</h2>'),
      template.indexOf('<!--        <table mat-table'),
    );

    expect(participantSection).toContain('organizerOverviewQuery.isPending()');
    expect(participantSection).toContain('organizerOverviewQuery.isError()');
    expect(participantSection).toContain('organizerOverviewQuery.isSuccess()');
    expect(participantSection).toContain('Failed to load participants.');
    expect(participantSection).toContain('No participants yet.');
  });
});

describe('event organize receipts query state', () => {
  it('guards receipt rows behind loaded event receipt data', () => {
    const template = readSource(
      'src/app/events/event-organize/event-organize.html',
    );
    const receiptSection = template.slice(
      template.indexOf('<h2 class="title-large">Receipts</h2>'),
      template.indexOf('</section>', template.indexOf('receiptsByEventQuery')),
    );

    expect(receiptSection).toContain('receiptsByEventQuery.isPending()');
    expect(receiptSection).toContain('receiptsByEventQuery.isError()');
    expect(receiptSection).toContain('receiptsByEventQuery.isSuccess()');
    expect(receiptSection).toContain('Failed to load receipts.');
    expect(receiptSection).toContain(
      'No receipts submitted for this event yet.',
    );
    expect(receiptSection).toContain('receiptsByEventQuery.data().length');
    expect(receiptSection).not.toContain('receiptsByEventQuery.data()?.length');
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

describe('RegistrationTransferDialog template', () => {
  it('guards transfer target actions behind loaded target data', () => {
    const template = readSource(
      'src/app/events/event-organize/registration-transfer-dialog.component.html',
    );

    expect(template).toContain('transferTargetsQuery.isPending()');
    expect(template).toContain('transferTargetsQuery.isError()');
    expect(template).toContain('transferTargetsQuery.isSuccess()');
    expect(template).toContain('Eligible members could not be loaded.');
    expect(template).toContain('No eligible transfer target found.');
    expect(template).toContain('transferTargetsQuery.data().length');
    expect(template).not.toContain('transferTargetsQuery.data()?.length');
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
