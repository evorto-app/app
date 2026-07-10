import { describe, expect, it } from 'vitest';

import { registrationIdFromPlatformScannerInput } from './platform-scanner.component';

describe('registrationIdFromPlatformScannerInput', () => {
  it('accepts a raw registration id', () => {
    expect(registrationIdFromPlatformScannerInput(' registration-1 ')).toBe(
      'registration-1',
    );
  });

  it('extracts an attendee ticket URL without trusting its origin', () => {
    expect(
      registrationIdFromPlatformScannerInput(
        'https://tenant.example/scan/registration/registration-1',
      ),
    ).toBe('registration-1');
  });

  it('rejects unrelated or ambiguous paths', () => {
    expect(
      registrationIdFromPlatformScannerInput(
        'https://tenant.example/events/registration-1',
      ),
    ).toBeUndefined();
    expect(
      registrationIdFromPlatformScannerInput(
        'https://tenant.example/scan/registration/registration-1/extra',
      ),
    ).toBeUndefined();
    expect(
      registrationIdFromPlatformScannerInput('registration/one'),
    ).toBeUndefined();
  });
});
