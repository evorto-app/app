import { render } from '@react-email/render';
import { describe, expect, it } from 'vitest';

import type { RegistrationCancellationKind } from '../../shared/registration-cancellation';

import {
  type RegistrationCancellationActor,
  RegistrationCancelledEmail,
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
      expect(output).not.toContain('transactional');
    }
  });

  it('states explicitly when no refund was started', async () => {
    const cancellation = await renderCancellation('organizer', 'notStarted');

    for (const output of [cancellation.html, cancellation.text]) {
      expect(output).toContain('No refund was started for this cancellation.');
      expect(output).not.toContain('refund is in progress');
      expect(output).not.toContain('transactional');
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
