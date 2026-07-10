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
});
