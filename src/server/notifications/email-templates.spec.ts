import { render } from '@react-email/render';
import { describe, expect, it } from 'vitest';

import {
  type RegistrationCancellationActor,
  RegistrationCancelledEmail,
} from './email-templates';

const renderCancellation = async (
  cancelledBy: RegistrationCancellationActor,
) => {
  const email = RegistrationCancelledEmail({
    cancelledBy,
    eventTitle: 'City tour',
    eventUrl: 'https://example.org/events/event-1',
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
      'You cancelled your registration for City tour.',
    );
    expect(participant.html).toContain(
      'Your registration for City tour was cancelled.',
    );
    expect(organizer.text).toContain(
      'An organizer cancelled your registration for City tour.',
    );
  });

  it('truthfully names a platform administrator without calling them an organizer', async () => {
    const platformAdministrator = await renderCancellation(
      'platformAdministrator',
    );

    expect(platformAdministrator.text).toContain(
      'A platform administrator cancelled your registration for City tour.',
    );
    expect(platformAdministrator.html).toContain(
      'A platform administrator cancelled your registration for City tour.',
    );
    expect(platformAdministrator.text).not.toContain('An organizer cancelled');
  });

  it('explains every eligibility change category after payment and the full queued refund', async () => {
    const eligibilityChanged = await renderCancellation(
      'eligibilityChangedAfterPayment',
    );

    for (const output of [eligibilityChanged.html, eligibilityChanged.text]) {
      expect(output).toContain(
        'the event or registration option was no longer available to you when payment completed',
      );
      expect(output).toContain('the event is no longer published');
      expect(output).toContain('the option was removed');
      expect(output).toContain('your organization membership or roles changed');
      expect(output).toContain(
        'The full amount you paid was queued for refund to your original payment method',
      );
      expect(output).toContain('Open your Profile to follow the refund status');
      expect(output).toContain(
        'current status and options or contact the organizer',
      );
      expect(output).not.toContain('An organizer cancelled');
    }
  });
});
