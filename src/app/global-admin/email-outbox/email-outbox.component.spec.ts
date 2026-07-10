import { describe, expect, it } from 'vitest';

import { emailOutboxKindLabel } from './email-outbox.component';

describe('emailOutboxKindLabel', () => {
  it('gives every durable email kind an operator-facing label', () => {
    expect(emailOutboxKindLabel).toEqual({
      manualApproval: 'Manual approval',
      receiptReviewed: 'Receipt reviewed',
      registrationCancelled: 'Registration cancelled',
      registrationConfirmed: 'Registration confirmed',
      registrationTransferred: 'Registration transferred',
      waitlistSpotAvailable: 'Waitlist spot available',
    });
  });
});
