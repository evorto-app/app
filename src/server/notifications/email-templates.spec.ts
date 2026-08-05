import { render } from '@react-email/render';
import { describe, expect, it } from 'vitest';

import type { RegistrationCancellationKind } from '../../shared/registration-cancellation';

import {
  ManualApprovalEmail,
  ReceiptReviewedEmail,
  type RegistrationCancellationActor,
  RegistrationCancelledEmail,
  RegistrationConfirmedEmail,
  RegistrationTransferredEmail,
  WaitlistSpotAvailableEmail,
} from './email-templates';

const renderCancellation = async (
  cancelledBy: RegistrationCancellationActor,
  refundOutcome: 'notStarted' | 'pending' = 'notStarted',
  cancellationKind: RegistrationCancellationKind = 'ticket',
) => {
  const email = RegistrationCancelledEmail({
    cancellationKind,
    cancelledBy,
    eventTitle: 'City tour',
    eventUrl: 'https://example.org/events/event-1',
    refundOutcome,
    tenantName: 'Example Section',
  });
  const [html, text] = await Promise.all([
    render(email),
    render(email, { plainText: true }),
  ]);

  return { html, text };
};

describe('RegistrationCancelledEmail', () => {
  it('keeps participant and organizer copy distinct', async () => {
    const [participant, organizer] = await Promise.all([
      renderCancellation('participant'),
      renderCancellation('organizer'),
    ]);

    expect(participant.text).toContain(
      'You cancelled your ticket for City tour.',
    );
    expect(participant.html).toContain('Ticket cancelled');
    expect(participant.html).toContain(
      'You cancelled your ticket for City tour.',
    );
    expect(organizer.text).toContain(
      'An organizer cancelled your ticket for City tour.',
    );
  });

  it('truthfully attributes a platform cancellation without exposing an internal role', async () => {
    const platformAdministrator = await renderCancellation(
      'platformAdministrator',
    );

    expect(platformAdministrator.text).toContain(
      'Evorto cancelled your ticket for City tour.',
    );
    expect(platformAdministrator.html).toContain(
      'Evorto cancelled your ticket for City tour.',
    );
    expect(platformAdministrator.text).not.toContain('An organizer cancelled');
    expect(platformAdministrator.text).not.toContain('platform administrator');
  });

  it('explains a post-payment cancellation and pending refund in plain language', async () => {
    const eligibilityChanged = await renderCancellation(
      'eligibilityChangedAfterPayment',
      'pending',
    );

    for (const output of [eligibilityChanged.html, eligibilityChanged.text]) {
      expect(output).toContain(
        'Your sign-up for City tour could not be completed',
      );
      expect(output).toContain(
        'the event or your access to it changed after you paid',
      );
      expect(output).toContain(
        'A refund to your original payment method is in progress',
      );
      expect(output).toContain('Open Profile → Events to follow it');
      expect(output).toContain('check the event or contact the organizer');
      expect(output).not.toContain('An organizer cancelled');
      expect(output).not.toContain('registration option');
      expect(output).not.toMatch(/\bregistration\b/iu);
      expect(output).not.toContain('roles changed');
      expect(output).not.toContain('queued for refund');
    }
  });

  it('states explicitly when no refund was started', async () => {
    const cancellation = await renderCancellation('organizer', 'notStarted');

    for (const output of [cancellation.html, cancellation.text]) {
      expect(output).toContain('No refund was started for this cancellation.');
      expect(output).not.toContain('refund is in progress');
    }
  });

  it.each([
    ['application', 'Application withdrawn', 'withdrew your application'],
    ['pendingSignUp', 'Sign-up cancelled', 'cancelled your pending sign-up'],
    ['waitlist', 'Waitlist place removed', 'removed you from the waitlist'],
  ] as const)(
    'describes a %s without calling it a ticket',
    async (kind, title, body) => {
      const email = await renderCancellation('organizer', 'notStarted', kind);

      expect(email.text.toLowerCase()).toContain(title.toLowerCase());
      expect(email.text).toContain(body);
      expect(email.text).not.toContain('your ticket');
    },
  );
});

describe('ReceiptReviewedEmail', () => {
  it('links directly to Profile receipts', async () => {
    const receipt = ReceiptReviewedEmail({
      eventTitle: 'City tour',
      receiptUrl: 'https://example.org/profile/receipts',
      rejectionReason: 'The total is not readable.',
      status: 'rejected',
      tenantName: 'Example Section',
    });
    const [html, text] = await Promise.all([
      render(receipt),
      render(receipt, { plainText: true }),
    ]);

    expect(html).toContain('https://example.org/profile/receipts');
    expect(html).toContain('Open your receipt in Evorto');
    expect(text).toContain(
      'Open Profile → Receipts to see the review and any reason provided.',
    );
  });
});

describe('RegistrationTransferredEmail', () => {
  it.each([
    ['pending', 'A refund to your original payment method is in progress.'],
    ['notStarted', 'No refund was started for this transfer.'],
  ] as const)(
    'shows the previous owner the %s refund outcome',
    async (refundOutcome, expectedCopy) => {
      const email = RegistrationTransferredEmail({
        eventTitle: 'City tour',
        eventUrl: 'https://example.org/events/event-1',
        recipientRole: 'previousOwner',
        refundOutcome,
        tenantName: 'Example Section',
      });

      const [html, text] = await Promise.all([
        render(email),
        render(email, { plainText: true }),
      ]);
      expect(html).toContain('Ticket transferred');
      expect(text).toContain(expectedCopy);
    },
  );

  it('does not show the previous owner refund outcome to the new owner', async () => {
    const email = RegistrationTransferredEmail({
      eventTitle: 'City tour',
      eventUrl: 'https://example.org/events/event-1',
      recipientRole: 'newOwner',
      refundOutcome: 'pending',
      tenantName: 'Example Section',
    });
    const [html, text] = await Promise.all([
      render(email),
      render(email, { plainText: true }),
    ]);

    expect(html).toContain('Ticket transferred to you');
    expect(text).not.toContain('refund');
  });
});

describe('outbound email language', () => {
  it('uses sign-up and ticket language for approval and confirmation titles', async () => {
    const [approved, paymentRequired, confirmed] = await Promise.all([
      render(
        ManualApprovalEmail({
          eventTitle: 'City tour',
          eventUrl: 'https://example.org/events/event-1',
          paymentDeadlineText: null,
          tenantName: 'Example Section',
        }),
      ),
      render(
        ManualApprovalEmail({
          eventTitle: 'City tour',
          eventUrl: 'https://example.org/events/event-1',
          paymentDeadlineText: 'Friday at 18:00',
          tenantName: 'Example Section',
        }),
      ),
      render(
        RegistrationConfirmedEmail({
          eventTitle: 'City tour',
          tenantName: 'Example Section',
          ticketUrl: 'https://example.org/events/event-1',
        }),
      ),
    ]);

    expect(approved).toContain('Sign-up approved');
    expect(approved).not.toContain('Sign-up approved: payment required');
    expect(approved).toContain('Your ticket for City tour is confirmed.');
    expect(paymentRequired).toContain('Sign-up approved: payment required');
    expect(paymentRequired).toContain(
      'Your sign-up for City tour was approved.',
    );
    expect(confirmed).toContain('Ticket confirmed');
    expect(confirmed).toContain('Your ticket for City tour is confirmed.');
  });

  it('keeps implementation language out of every email', async () => {
    const emails = [
      ManualApprovalEmail({
        eventTitle: 'City tour',
        eventUrl: 'https://example.org/events/event-1',
        paymentDeadlineText: 'Friday at 18:00',
        tenantName: 'Example Section',
      }),
      ReceiptReviewedEmail({
        eventTitle: 'City tour',
        receiptUrl: 'https://example.org/profile/receipts',
        rejectionReason: 'The total is not readable.',
        status: 'rejected',
        tenantName: 'Example Section',
      }),
      RegistrationConfirmedEmail({
        eventTitle: 'City tour',
        tenantName: 'Example Section',
        ticketUrl: 'https://example.org/events/event-1',
      }),
      RegistrationCancelledEmail({
        cancellationKind: 'ticket',
        cancelledBy: 'platformAdministrator',
        eventTitle: 'City tour',
        eventUrl: 'https://example.org/events/event-1',
        refundOutcome: 'notStarted',
        tenantName: 'Example Section',
      }),
      RegistrationTransferredEmail({
        eventTitle: 'City tour',
        eventUrl: 'https://example.org/events/event-1',
        recipientRole: 'previousOwner',
        refundOutcome: 'pending',
        tenantName: 'Example Section',
      }),
      WaitlistSpotAvailableEmail({
        eventTitle: 'City tour',
        eventUrl: 'https://example.org/events/event-1',
        tenantName: 'Example Section',
      }),
    ];

    const messages = await Promise.all(
      emails.map((email) => render(email, { plainText: true })),
    );

    for (const message of messages) {
      expect(message).not.toMatch(
        /\b(?:application|authentication|database|domain|endpoint|metadata|participant|payload|provider|registration|rpc|tenant|transactional)\b|platform administrator|queued for refund/iu,
      );
    }
  });
});
