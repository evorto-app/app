import '@angular/compiler';
import { readFileSync } from 'node:fs';
import nodePath from 'node:path';

import {
  unsupportedPlatformEventRegistrationOptions,
  writablePlatformEventRegistrationOptions,
} from './platform-event-detail.component';

describe('platform event registration-mode compatibility', () => {
  it('identifies legacy random options without treating supported modes as blocked', () => {
    const supportedOptions = [
      { registrationMode: 'application' as const },
      { registrationMode: 'fcfs' as const },
    ] as const;
    const randomOption = { registrationMode: 'random' as const };
    const options = [...supportedOptions, randomOption];

    expect(unsupportedPlatformEventRegistrationOptions(options)).toEqual([
      randomOption,
    ]);
    expect(writablePlatformEventRegistrationOptions(options)).toBeUndefined();
    expect(writablePlatformEventRegistrationOptions(supportedOptions)).toEqual(
      supportedOptions,
    );
  });

  it('shows legacy random as a disabled migration state, not a writable option', () => {
    const template = readFileSync(
      nodePath.join(
        process.cwd(),
        'src/app/global-admin/platform-event-operations/platform-event-detail.component.html',
      ),
      'utf8',
    );

    expect(template).toContain('Registration-mode migration required');
    expect(template).toMatch(/<mat-option\s+disabled\s+value="random"/);
    expect(template).not.toContain('<mat-option value="random"');
    expect(template).toContain('unsupportedRegistrationOptions().length > 0');
  });
});
