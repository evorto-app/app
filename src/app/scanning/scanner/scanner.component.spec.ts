import { describe, expect, it } from 'vitest';

import {
  registrationIdFromScannedTicketUrl,
  scannerCameraErrorMessage,
  scannerNonTicketMessage,
} from './scanner.component';

describe('scannerCameraErrorMessage', () => {
  it('maps denied camera permission to a retryable permission message', () => {
    expect(
      scannerCameraErrorMessage(new DOMException('', 'NotAllowedError')),
    ).toContain('Allow camera access');
  });

  it('maps missing camera devices to a device message', () => {
    expect(
      scannerCameraErrorMessage(new DOMException('', 'NotFoundError')),
    ).toContain('No camera was found');
  });

  it('maps busy camera devices to a recoverable message', () => {
    expect(
      scannerCameraErrorMessage(new DOMException('', 'NotReadableError')),
    ).toContain('already in use');
  });

  it('keeps unknown camera errors readable', () => {
    expect(scannerCameraErrorMessage(new Error('boom'))).toContain(
      'could not be started',
    );
  });
});

describe('registrationIdFromScannedTicketUrl', () => {
  it('accepts a scan URL from the current app origin', () => {
    expect(
      registrationIdFromScannedTicketUrl(
        'https://tenant.example.com/scan/registration/registration-1',
      ),
    ).toBe('registration-1');
  });

  it('accepts a scan URL from another tenant/domain origin by product decision', () => {
    expect(
      registrationIdFromScannedTicketUrl(
        'https://custom-tenant.example.org/scan/registration/registration-1',
      ),
    ).toBe('registration-1');
  });

  it('rejects invalid QR code payloads', () => {
    expect(registrationIdFromScannedTicketUrl('not a url')).toBeUndefined();
  });

  it('rejects URLs outside the exact scan registration path', () => {
    expect(
      registrationIdFromScannedTicketUrl(
        'https://tenant.example.com/scan/registration/registration-1/extra',
      ),
    ).toBeUndefined();
    expect(
      registrationIdFromScannedTicketUrl(
        'https://tenant.example.com/not-scan/registration/registration-1',
      ),
    ).toBeUndefined();
  });
});

describe('scanner ticket feedback', () => {
  it('keeps non-ticket QR feedback separate from camera recovery', () => {
    expect(scannerNonTicketMessage).toContain('not an Evorto ticket');
    expect(scannerNonTicketMessage).toContain('Keep the camera open');
    expect(scannerNonTicketMessage).not.toContain('camera could not');
  });
});
