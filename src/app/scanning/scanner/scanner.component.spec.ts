import { describe, expect, it } from 'vitest';

import { scannerCameraErrorMessage } from './scanner.component';

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
