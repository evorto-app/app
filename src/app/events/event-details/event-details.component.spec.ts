import '@angular/compiler';
import { readFileSync } from 'node:fs';
import nodePath from 'node:path';
import { describe, expect, it } from 'vitest';

import { registrationOptionsState } from './event-details.component';

const readSource = (sourcePath: string): string =>
  readFileSync(nodePath.join(process.cwd(), sourcePath), 'utf8');

describe('registrationOptionsState', () => {
  it('shows available registration options when at least one option is visible', () => {
    expect(
      registrationOptionsState({
        registrationOptions: [{}],
        registrationOptionsHiddenByEligibility: false,
      }),
    ).toBe('visible');
  });

  it('shows an explicit ineligible state when every option is hidden by role eligibility', () => {
    expect(
      registrationOptionsState({
        registrationOptions: [],
        registrationOptionsHiddenByEligibility: true,
      }),
    ).toBe('hiddenByEligibility');
  });

  it('keeps optionless events distinct from role-ineligible events', () => {
    expect(
      registrationOptionsState({
        registrationOptions: [],
        registrationOptionsHiddenByEligibility: false,
      }),
    ).toBe('none');
  });
});

describe('EventDetails template', () => {
  it('keeps event and registration actions behind explicit query states', () => {
    const template = readSource(
      'src/app/events/event-details/event-details.component.html',
    );

    expect(template).toContain('eventQuery.isPending()');
    expect(template).toContain('Loading event ...');
    expect(template).toContain('eventQuery.isError()');
    expect(template).toContain('Failed to load event.');
    expect(template).toContain('eventQuery.isSuccess()');
    expect(template).toContain('registrationStatusQuery.isPending()');
    expect(template).toContain('registrationStatusQuery.isError()');
    expect(template).toContain('Failed to load registration status.');
    expect(template).toContain('registrationStatusQuery.isSuccess()');
  });
});
