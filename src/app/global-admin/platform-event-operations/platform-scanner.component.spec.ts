import { readFileSync } from 'node:fs';
import nodePath from 'node:path';
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

  it('keeps lookup controls disabled until browser hydration completes', () => {
    const source = readFileSync(
      nodePath.join(
        process.cwd(),
        'src/app/global-admin/platform-event-operations/platform-scanner.component.ts',
      ),
      'utf8',
    );
    const template = readFileSync(
      nodePath.join(
        process.cwd(),
        'src/app/global-admin/platform-event-operations/platform-scanner.component.html',
      ),
      'utf8',
    );

    expect(source).toContain(
      'afterNextRender(() => this.lookupInteractive.set(true))',
    );
    expect(
      template.match(/\[disabled\]="!lookupInteractive\(\)"/g),
    ).toHaveLength(2);
  });
});
