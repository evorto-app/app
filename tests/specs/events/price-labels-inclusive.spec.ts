import type { Page } from '@playwright/test';

import { defaultStateFile } from '../../../helpers/user-data';
import { expect, test } from '../../support/fixtures/parallel-test';

test.use({ storageState: defaultStateFile });

const openEventDetail = async (page: Page, eventId: string) => {
  await page.getByRole('link', { name: 'Events' }).click();
  await expect(page).toHaveURL(/\/events/);
  await page.locator(`a[href="/events/${eventId}"]`).click();
  await expect(page).toHaveURL(`/events/${eventId}`);
};

test.describe.skip('Inclusive Price Labels', () => {
  test('paid prices display inclusive tax labels @events @taxRates @priceLabels @track(playwright-specs-track-linking_20260126) @req(PRICE-LABELS-INCLUSIVE-SPEC-01)', async ({
    page,
    events,
  }) => {
    // Find an event with paid registration options
    const paidEvent = events.find(
      (event) =>
        event.status === 'APPROVED' &&
        !event.unlisted &&
        event.registrationOptions.some(
          (option) =>
            option.isPaid && option.title === 'Participant registration',
        ),
    );

    if (!paidEvent) {
      test.skip('No paid events available for testing @track(playwright-specs-track-linking_20260126) @req(PRICE-LABELS-INCLUSIVE-SPEC-02)');
    }

    await page.goto('.');

    await openEventDetail(page, paidEvent.id);

    // Check that paid registration options show inclusive tax labels
    // Format should be "Incl. <percentage>% <name>" next to price
    // TODO: This test will fail until FR-011 is implemented

    const paidOptions = paidEvent.registrationOptions.filter(
      (option) => option.isPaid && option.title === 'Participant registration',
    );

    for (const option of paidOptions) {
      // Look for the registration option and its price label
      const optionLocator = page.getByText(option.title);
      await expect(optionLocator).toBeVisible();

      // TODO: Verify inclusive tax label is displayed
      // Should show format like "€25.00 Incl. 19% VAT" or similar
      // This assertion will need to be updated when the actual UI is implemented
    }

    // Placeholder assertion - will be updated when inclusive labels are implemented
    await expect(
      page.getByRole('heading', { level: 1, name: paidEvent.title }),
    ).toBeVisible();
  });

  test('free prices do not show tax labels @events @taxRates @priceLabels @track(playwright-specs-track-linking_20260126) @req(PRICE-LABELS-INCLUSIVE-SPEC-03)', async ({
    page,
    events,
  }) => {
    // Find an event with free registration options
    const eventWithFreeOptions = events.find(
      (event) =>
        event.status === 'APPROVED' &&
        !event.unlisted &&
        event.registrationOptions.some(
          (option) =>
            !option.isPaid && option.title === 'Participant registration',
        ),
    );

    if (!eventWithFreeOptions) {
      test.skip('No events with free options available for testing @track(playwright-specs-track-linking_20260126) @req(PRICE-LABELS-INCLUSIVE-SPEC-04)');
    }

    await page.goto('.');

    await openEventDetail(page, eventWithFreeOptions.id);

    const freeOptions = eventWithFreeOptions.registrationOptions.filter(
      (option) => !option.isPaid && option.title === 'Participant registration',
    );

    for (const option of freeOptions) {
      const optionLocator = page.getByText(option.title);
      await expect(optionLocator).toBeVisible();

      // TODO: Verify that free options do NOT show tax labels
      // Should show "Free" or price "€0.00" without any "Incl. X%" text
    }

    // Placeholder assertion
    await expect(
      page.getByRole('heading', { level: 1, name: eventWithFreeOptions.title }),
    ).toBeVisible();
  });

  test('zero percent tax rate shows "Tax free" label @events @taxRates @priceLabels @track(playwright-specs-track-linking_20260126) @req(PRICE-LABELS-INCLUSIVE-SPEC-05)', async ({
    page,
    events,
  }) => {
    // This test validates FR-022: zero-percent inclusive tax rates
    // Should show "Tax free" instead of "Incl. 0% VAT"

    await page.goto('.');

    // TODO: Find or create event with 0% tax rate option
    // Verify it shows "Tax free" label instead of "Incl. 0% VAT"

    await page.getByRole('link', { name: 'Events' }).click();

    // Placeholder assertion - will be updated when 0% rate handling is implemented
    await expect(page.getByRole('heading', { name: 'Events' })).toBeVisible();
  });

  test('fallback label shown when tax rate unavailable @events @taxRates @priceLabels @track(playwright-specs-track-linking_20260126) @req(PRICE-LABELS-INCLUSIVE-SPEC-06)', async ({
    page,
    events,
  }) => {
    // This test validates FR-017: fallback "Incl. Tax" when rate details unavailable

    const paidEvent = events.find(
      (event) =>
        event.status === 'APPROVED' &&
        !event.unlisted &&
        event.registrationOptions.some((option) => option.isPaid),
    );

    if (!paidEvent) {
      test.skip('No paid events available for testing @track(playwright-specs-track-linking_20260126) @req(PRICE-LABELS-INCLUSIVE-SPEC-07)');
    }

    await page.goto('.');

    await openEventDetail(page, paidEvent.id);

    // TODO: Simulate scenario where tax rate details cannot be resolved
    // Should show generic "Incl. Tax" label instead of specific percentage/name
    // This might require mocking or setting up specific test data

    // For now, just verify the event loads
    await expect(
      page.getByRole('heading', { level: 1, name: paidEvent.title }),
    ).toBeVisible();
  });

  test('price labels consistent across all pages @events @taxRates @priceLabels @track(playwright-specs-track-linking_20260126) @req(PRICE-LABELS-INCLUSIVE-SPEC-08)', async ({
    page,
    events,
  }) => {
    // This test validates FR-011: consistent labeling across listings, detail pages, carts, checkout

    const paidEvent = events.find(
      (event) =>
        event.status === 'APPROVED' &&
        !event.unlisted &&
        event.registrationOptions.some((option) => option.isPaid),
    );

    if (!paidEvent) {
      test.skip('No paid events available for testing @track(playwright-specs-track-linking_20260126) @req(PRICE-LABELS-INCLUSIVE-SPEC-09)');
    }

    await page.goto('.');

    // Check event listing page
    await page.getByRole('link', { name: 'Events' }).click();
    // TODO: Verify price labels are shown in event cards/list items

    // Check event detail page
    await page.locator(`a[href="/events/${paidEvent.id}"]`).click();
    await expect(page).toHaveURL(`/events/${paidEvent.id}`);
    // TODO: Verify same price labels are shown in detail view

    // TODO: Check cart/checkout pages when implementing registration flow
    // Should show consistent "Incl. X% Y" format throughout

    // Placeholder assertion
    await expect(
      page.getByRole('heading', { level: 1, name: paidEvent.title }),
    ).toBeVisible();
  });

  test('discounted prices maintain inclusive tax labels @events @taxRates @priceLabels @track(playwright-specs-track-linking_20260126) @req(PRICE-LABELS-INCLUSIVE-SPEC-10)', async ({
    page,
    events,
  }) => {
    // This test validates FR-014: discounts reduce final price while retaining original tax label

    const paidEvent = events.find(
      (event) =>
        event.status === 'APPROVED' &&
        !event.unlisted &&
        event.registrationOptions.some((option) => option.isPaid),
    );

    if (!paidEvent) {
      test.skip('No paid events available for testing @track(playwright-specs-track-linking_20260126) @req(PRICE-LABELS-INCLUSIVE-SPEC-11)');
    }

    await page.goto('.');

    await openEventDetail(page, paidEvent.id);

    // TODO: Apply a discount code and verify:
    // - Reduced price is shown
    // - Original tax label format is maintained (e.g., "€20.00 Incl. 19% VAT" from original "€25.00 Incl. 19% VAT")
    // - Tax percentage and name stay the same, only amount changes

    // This requires discount functionality to be available
    // For now, placeholder assertion
    await expect(
      page.getByRole('heading', { level: 1, name: paidEvent.title }),
    ).toBeVisible();
  });

  test('template detail view shows inclusive labels for paid options @templates @taxRates @priceLabels @track(playwright-specs-track-linking_20260126) @req(PRICE-LABELS-INCLUSIVE-SPEC-12)', async ({
    page,
    templates,
  }) => {
    // Test that template details also show inclusive tax labels for paid options

    await page.goto('.');

    await page.getByRole('link', { name: 'Templates' }).click();
    await expect(page).toHaveURL(/\/templates/);

    // Find a template (assuming templates have registration options)
    const template = templates[0];
    await page.locator(`a[href="/templates/${template.id}"]`).click();
    await expect(page).toHaveURL(`/templates/${template.id}`);

    // TODO: Verify that template view shows inclusive tax labels for paid registration options
    // Format should be consistent with event pages

    // Placeholder assertion
    await expect(
      page.getByRole('heading', { level: 1, name: template.title }),
    ).toBeVisible();
  });
});
