import { describe, expect, it } from 'vitest';

import { requiresTenantOnboarding } from './user-account.guard';

describe('requiresTenantOnboarding', () => {
  it('redirects authenticated users until current tenant requirements are complete', () => {
    expect(
      requiresTenantOnboarding({
        isAuthenticated: true,
        onboardingComplete: false,
      }),
    ).toBe(true);
    expect(
      requiresTenantOnboarding({
        isAuthenticated: true,
        onboardingComplete: true,
      }),
    ).toBe(false);
  });

  it('does not redirect public visitors into authenticated setup', () => {
    expect(
      requiresTenantOnboarding({
        isAuthenticated: false,
        onboardingComplete: false,
      }),
    ).toBe(false);
  });
});
