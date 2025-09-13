import { expect } from '@playwright/test';
import { test } from '../../fixtures/parallel-test';

test.describe('baseline seed invariants', () => {
  test('tenant, categories, and events are seeded with paid and free options', async ({ tenant, templateCategories, events }) => {
    expect.soft(tenant.id).toBeTruthy();
    expect.soft(tenant.domain).toBeTruthy();

    expect.soft(templateCategories.length).toBeGreaterThanOrEqual(2);

    expect(events.length).toBeGreaterThan(0);
    const allOptions = events.flatMap((e) => e.registrationOptions);
    // At least one free and one paid option across seeded events
    expect.soft(allOptions.some((o) => o.isPaid === true)).toBeTruthy();
    expect.soft(allOptions.some((o) => o.isPaid === false)).toBeTruthy();
  });
});

