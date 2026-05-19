import { describe, expect, it } from 'vitest';

import {
  profileEventDetailActionLabel,
  registrationPaymentLabel,
  registrationStatusLabel,
} from './user-profile.component';

describe('profile event labels', () => {
  it('labels the event-details action without claiming profile ticket handling', () => {
    expect(profileEventDetailActionLabel()).toBe('Open event page');
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
