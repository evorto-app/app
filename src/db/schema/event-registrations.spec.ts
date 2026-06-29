import { describe, expect, it } from '@effect/vitest';
import { readFileSync } from 'node:fs';

describe('event registration schema', () => {
  it('does not expose legacy paymentStatus state', () => {
    const eventRegistrationsSource = readFileSync(
      new URL('event-registrations.ts', import.meta.url),
      'utf8',
    );
    const globalEnumsSource = readFileSync(
      new URL('global-enums.ts', import.meta.url),
      'utf8',
    );

    expect(eventRegistrationsSource).not.toContain('paymentStatus');
    expect(globalEnumsSource).not.toContain('paymentStatus');
    expect(globalEnumsSource).not.toContain("pgEnum('payment_status'");
  });
});
