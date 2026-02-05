import { expect, test } from '../../support/fixtures/parallel-test';

// This particular test validates seeded invariants and can take longer
// due to initial database seeding. Keep the override local to this file.
test.setTimeout(120_000);

test.describe('baseline seed invariants', () => {
  test(
    'tenant, categories, and events are seeded with paid and free options @track(playwright-specs-track-linking_20260126) @req(SEED-BASELINE-TEST-01)',
    async ({ tenant, templateCategories, events }) => {
      expect.soft(tenant.id).toBeTruthy();
      expect.soft(tenant.domain).toBeTruthy();

      expect.soft(templateCategories.length).toBeGreaterThanOrEqual(2);

      expect(events.length).toBeGreaterThan(0);
      const allOptions = events.flatMap((e) => e.registrationOptions);
      // At least one free and one paid option across seeded events
      expect.soft(allOptions.some((o) => o.isPaid === true)).toBeTruthy();
      expect.soft(allOptions.some((o) => o.isPaid === false)).toBeTruthy();
    },
  );
});
