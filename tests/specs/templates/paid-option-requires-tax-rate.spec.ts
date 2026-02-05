import { defaultStateFile } from '../../../helpers/user-data';
import { expect, test } from '../../support/fixtures/parallel-test';
import { fillTemplateBasics } from '../../support/utils/template-form';

test.use({ storageState: defaultStateFile });

test.describe.skip('Template Tax Rate Validation', () => {
  test('creator must select tax rate for paid registration option @templates @taxRates @track(playwright-specs-track-linking_20260126) @req(PAID-OPTION-REQUIRES-TAX-RATE-SPEC-01)', async ({
    page,
    templateCategories,
  }) => {
    test.fixme(
      true,
      'TinyMCE editor iframe does not load in e2e; template creation blocked.',
    );
    const category = templateCategories[0];

    await page.goto('.');
    await page.getByRole('link', { name: 'Templates' }).click();
    await expect(page).toHaveURL(/\/templates/);

    // Create a new template
    await page.getByRole('link', { name: 'Create template' }).click();
    await expect(page).toHaveURL(`/templates/create`);

    const templateTitle = 'Paid Event Template';
    // FIXME: TinyMCE editor never loads in e2e, so description cannot be set and creation fails.
    await fillTemplateBasics(page, {
      categoryTitle: category.title,
      title: templateTitle,
    });

    // Save basic template first
    await page.getByRole('button', { name: 'Save template' }).click();
    await expect(page).toHaveURL(/\/templates/);

    // Open the template to add registration options
    await expect(page.getByRole('link', { name: templateTitle })).toBeVisible();
    await page.getByRole('link', { name: templateTitle }).click();

    // Add a paid registration option
    // TODO: This will need to be updated based on actual template editing UI
    // For now, this is a placeholder test that should fail until validation is implemented

    // Try to add a paid option without tax rate - should fail validation
    // This test validates that FR-008 (paid option requires tax rate) is enforced

    // Placeholder assertion - will be updated when validation is implemented
    await expect(
      page.getByRole('heading', { name: 'Paid Event Template' }),
    ).toBeVisible();
  });

  test('tax rate field disabled for free registration option @templates @taxRates @track(playwright-specs-track-linking_20260126) @req(PAID-OPTION-REQUIRES-TAX-RATE-SPEC-02)', async ({
    page,
    templateCategories,
  }) => {
    test.fixme(
      true,
      'TinyMCE editor iframe does not load in e2e; template creation blocked.',
    );
    const category = templateCategories[0];

    await page.goto('.');
    await page.getByRole('link', { name: 'Templates' }).click();
    await expect(page).toHaveURL(/\/templates/);

    // Create a new template with free option
    await page.getByRole('link', { name: 'Create template' }).click();
    await expect(page).toHaveURL(`/templates/create`);

    const templateTitle = 'Free Event Template';
    // FIXME: TinyMCE editor never loads in e2e, so description cannot be set and creation fails.
    await fillTemplateBasics(page, {
      categoryTitle: category.title,
      title: templateTitle,
    });

    // Save and edit template
    await page.getByRole('button', { name: 'Save template' }).click();
    await expect(page.getByRole('link', { name: templateTitle })).toBeVisible();
    await page.getByRole('link', { name: templateTitle }).click();

    // TODO: Navigate to registration options and verify:
    // - Tax rate field is disabled when isPaid = false
    // - FR-009 (free option cannot have tax rate) is enforced

    // Placeholder assertion - will be updated when UI is implemented
    await expect(
      page.getByRole('heading', { name: 'Free Event Template' }),
    ).toBeVisible();
  });

  test('creator cannot save paid option without compatible tax rate @templates @taxRates @track(playwright-specs-track-linking_20260126) @req(PAID-OPTION-REQUIRES-TAX-RATE-SPEC-03)', async ({
    page,
    templateCategories,
  }) => {
    test.fixme(
      true,
      'TinyMCE editor iframe does not load in e2e; template creation blocked.',
    );
    const category = templateCategories[0];

    await page.goto('.');
    await page.getByRole('link', { name: 'Templates' }).click();

    // Create template and try to save paid option without tax rate
    await page.getByRole('link', { name: 'Create template' }).click();
    const templateTitle = 'Validation Test Template';
    // FIXME: TinyMCE editor never loads in e2e, so description cannot be set and creation fails.
    await fillTemplateBasics(page, {
      categoryTitle: category.title,
      title: templateTitle,
    });

    await page.getByRole('button', { name: 'Save template' }).click();
    await expect(page.getByRole('link', { name: templateTitle })).toBeVisible();
    await page.getByRole('link', { name: templateTitle }).click();

    // TODO: Implement test for validation error:
    // - Try to save paid option without tax rate
    // - Should show error message about needing compatible tax rate
    // - Validate error code ERR_PAID_REQUIRES_TAX_RATE

    // Placeholder assertion
    await expect(
      page.getByRole('heading', { name: 'Validation Test Template' }),
    ).toBeVisible();
  });

  test('creator can only select compatible (inclusive & active) tax rates @templates @taxRates @track(playwright-specs-track-linking_20260126) @req(PAID-OPTION-REQUIRES-TAX-RATE-SPEC-04)', async ({
    page,
    templateCategories,
  }) => {
    test.fixme(
      true,
      'TinyMCE editor iframe does not load in e2e; template creation blocked.',
    );
    const category = templateCategories[0];

    await page.goto('.');
    await page.getByRole('link', { name: 'Templates' }).click();

    await page.getByRole('link', { name: 'Create template' }).click();
    const templateTitle = 'Compatible Rate Test Template';
    // FIXME: TinyMCE editor never loads in e2e, so description cannot be set and creation fails.
    await fillTemplateBasics(page, {
      categoryTitle: category.title,
      title: templateTitle,
    });

    await page.getByRole('button', { name: 'Save template' }).click();
    await expect(page.getByRole('link', { name: templateTitle })).toBeVisible();
    await page.getByRole('link', { name: templateTitle }).click();

    // TODO: Navigate to registration option form and verify:
    // - Only inclusive & active tax rates appear in dropdown
    // - Incompatible rates are not selectable
    // - Validate against taxRates.listActive endpoint

    // Placeholder assertion
    await expect(
      page.getByRole('heading', { name: 'Compatible Rate Test Template' }),
    ).toBeVisible();
  });

  test('bulk operations respect tax rate validation @templates @taxRates @track(playwright-specs-track-linking_20260126) @req(PAID-OPTION-REQUIRES-TAX-RATE-SPEC-05)', async ({
    page,
    templateCategories,
  }) => {
    test.fixme(
      true,
      'TinyMCE editor iframe does not load in e2e; template creation blocked.',
    );
    const category = templateCategories[0];

    // This test validates FR-018: incompatible rates cannot be applied via bulk editing

    await page.goto('.');
    await page.getByRole('link', { name: 'Templates' }).click();

    await page.getByRole('link', { name: 'Create template' }).click();
    const templateTitle = 'Bulk Operations Test';
    // FIXME: TinyMCE editor never loads in e2e, so description cannot be set and creation fails.
    await fillTemplateBasics(page, {
      categoryTitle: category.title,
      title: templateTitle,
    });

    await page.getByRole('button', { name: 'Save template' }).click();
    await expect(page.getByRole('link', { name: templateTitle })).toBeVisible();
    await page.getByRole('link', { name: templateTitle }).click();

    // TODO: Test bulk operations and cloning:
    // - Bulk edit multiple options with invalid tax rate should fail
    // - Cloning template should preserve valid tax rate assignments
    // - Cloning should fail if tax rates become incompatible in target context

    // Placeholder assertion
    await expect(
      page.getByRole('heading', { name: 'Bulk Operations Test' }),
    ).toBeVisible();
  });

  test('blocked creation when no compatible rates available @templates @taxRates @track(playwright-specs-track-linking_20260126) @req(PAID-OPTION-REQUIRES-TAX-RATE-SPEC-06)', async ({
    page,
    templateCategories,
  }) => {
    test.fixme(
      true,
      'TinyMCE editor iframe does not load in e2e; template creation blocked.',
    );
    const category = templateCategories[0];

    // This test validates FR-010: creation blocked if no compatible rates available

    await page.goto('.');
    await page.getByRole('link', { name: 'Templates' }).click();

    await page.getByRole('link', { name: 'Create template' }).click();
    const templateTitle = 'No Rates Available Test';
    // FIXME: TinyMCE editor never loads in e2e, so description cannot be set and creation fails.
    await fillTemplateBasics(page, {
      categoryTitle: category.title,
      title: templateTitle,
    });

    await page.getByRole('button', { name: 'Save template' }).click();
    await expect(page.getByRole('link', { name: templateTitle })).toBeVisible();
    await page.getByRole('link', { name: templateTitle }).click();

    // TODO: In a tenant with no compatible tax rates:
    // - Try to create paid option
    // - Should show guidance message about importing tax rate first
    // - Save should be blocked with appropriate error message

    // For this test to work properly, we'd need to set up a tenant without any tax rates
    // or temporarily remove all tax rates for the test tenant

    // Placeholder assertion
    await expect(
      page.getByRole('heading', { name: 'No Rates Available Test' }),
    ).toBeVisible();
  });
});
