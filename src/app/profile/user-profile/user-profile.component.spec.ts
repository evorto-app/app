import { describe, expect, it } from 'vitest';

import {
  profileEventActionNote,
  profileEventDetailActionLabel,
  profileEventGuestLabel,
  registrationPaymentLabel,
  registrationStatusLabel,
} from './user-profile.component';

describe('profile event labels', () => {
  it('labels the event-details action without claiming profile ticket handling', () => {
    expect(profileEventDetailActionLabel()).toBe('Open event page');
  });

  it('keeps deferred profile event actions explicit', () => {
    expect(profileEventActionNote('CONFIRMED')).toContain(
      'Cancellation, refunds, and transfer/resale are not managed from profile yet.',
    );
    expect(profileEventActionNote('PENDING')).toBe(
      'Pending-registration changes are handled from the event page when available.',
    );
    expect(profileEventActionNote('WAITLIST')).toBe(
      'Waitlist movement is not managed from profile yet. Open the event page for current details.',
    );
  });

  it('labels guest quantities only when a registration includes guests', () => {
    expect(profileEventGuestLabel(0)).toBeNull();
    expect(profileEventGuestLabel(1)).toBe('Includes 1 guest');
    expect(profileEventGuestLabel(2)).toBe('Includes 2 guests');
  });

  it('keeps registration payment states readable', () => {
    expect(registrationPaymentLabel('cancelled')).toBe('Payment cancelled');
    expect(registrationPaymentLabel('notRequired')).toBe('No payment required');
    expect(registrationPaymentLabel('pending')).toBe('Payment pending');
    expect(registrationPaymentLabel('recorded')).toBe('Payment recorded');
  });

  it('keeps registration status labels aligned with persisted states', () => {
    expect(registrationStatusLabel('CONFIRMED')).toBe('Confirmed');
    expect(registrationStatusLabel('PENDING')).toBe('Pending');
    expect(registrationStatusLabel('WAITLIST')).toBe('Waitlist');
  });
});
