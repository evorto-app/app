import { getId } from '../../../helpers/get-id';
import { organizerStateFile } from '../../../helpers/user-data';
import * as schema from '../../../src/db/schema';
import { expect, test } from '../../support/fixtures/parallel-test';
import { fillTemplateBasics } from '../../support/utils/template-form';

test.setTimeout(120000);

test.use({ storageState: organizerStateFile });

test('create template in empty category', async ({
  database,
  page,
  tenant,
}) => {
  const icon = await database.query.icons.findFirst({
    where: { tenantId: tenant.id },
  });
  if (!icon) {
    throw new Error('Expected seeded icons for template category creation');
  }

  const categoryTitle = `Empty ${getId().slice(0, 6)}`;
  const [category] = await database
    .insert(schema.eventTemplateCategories)
    .values({
      icon: { iconColor: icon.sourceColor ?? 0, iconName: icon.commonName },
      tenantId: tenant.id,
      title: categoryTitle,
    })
    .returning();
  await page.goto('.');
  await page.getByRole('link', { name: 'Templates' }).click();
  await expect(page).toHaveURL(/\/templates/);
  const categoryCard = page
    .getByRole('heading', { name: category.title })
    .locator('..')
    .locator('..');
  await categoryCard
    .getByRole('link', { name: 'Add template to this category' })
    .click();
  await expect(page).toHaveURL(`/templates/create/${category.id}`);
  await expect(page.getByLabel('Template Category')).toHaveText(category.title);
});

test('create a new template', async ({ page, templateCategories }) => {
  const category = templateCategories[0];
  if (!category) {
    throw new Error('Expected seeded template category before template create');
  }
  const templateTitle = `Historical tour ${getId().slice(0, 6)}`;
  await page.goto('.');
  await page.getByRole('link', { name: 'Templates' }).click();
  await expect(page).toHaveURL(/\/templates/);
  await page.getByRole('link', { name: 'Create template' }).click();
  await expect(page).toHaveURL(`/templates/create`);
  await fillTemplateBasics(page, {
    categoryTitle: category.title,
    title: templateTitle,
  });
  await page.getByRole('button', { name: 'Save template' }).click();
  await expect(page).toHaveURL(/\/templates/);
  await expect(page.getByRole('link', { name: templateTitle })).toBeVisible();
});

test('create template with reusable add-ons and registration questions', async ({
  database,
  page,
  templateCategories,
  tenant,
}) => {
  const category = templateCategories[0];
  if (!category) {
    throw new Error(
      'Expected seeded template category before reusable template create',
    );
  }
  const templateTitle = `Reusable setup ${getId().slice(0, 6)}`;
  const planningTips = 'Bring printed waiver forms.';
  const addOnTitle = `Snack voucher ${getId().slice(0, 6)}`;
  const addOnDescription = 'Reusable snack add-on for participant signup.';
  const questionTitle = `Dietary restrictions ${getId().slice(0, 6)}`;
  const questionDescription = 'Tell organizers about allergies or preferences.';

  await page.goto('.');
  await page.getByRole('link', { name: 'Templates' }).click();
  await expect(page).toHaveURL(/\/templates/);
  await page.getByRole('link', { name: 'Create template' }).click();
  await expect(page).toHaveURL('/templates/create');

  await fillTemplateBasics(page, {
    categoryTitle: category.title,
    title: templateTitle,
  });
  await page.getByLabel('Organizer planning tips').fill(planningTips);

  await page.getByRole('button', { name: 'Add add-on' }).click();
  const addOnForm = page.locator('app-template-addon-form').first();
  await addOnForm.getByLabel('Add-on name').fill(addOnTitle);
  await addOnForm.getByLabel('Description').fill(addOnDescription);
  await addOnForm.getByLabel('Included quantity').fill('2');
  await addOnForm.getByLabel('Available quantity').fill('12');
  await addOnForm.getByLabel('Max per user').fill('3');

  await page.getByRole('button', { name: 'Add question' }).click();
  const questionForm = page.locator('app-template-question-form').first();
  await questionForm.getByLabel('Question').fill(questionTitle);
  await questionForm.getByLabel('Help text').fill(questionDescription);

  await page.getByRole('button', { name: 'Save template' }).click();
  await expect(page).toHaveURL(/\/templates\/[^/]+$/);
  await expect(
    page.getByRole('heading', { name: templateTitle }),
  ).toBeVisible();
  await expect(page.getByText(addOnTitle)).toBeVisible();
  await expect(page.getByText(questionTitle)).toBeVisible();

  const createdTemplate = await database.query.eventTemplates.findFirst({
    where: {
      tenantId: tenant.id,
      title: templateTitle,
    },
  });
  if (!createdTemplate) {
    throw new Error('Expected reusable template write to persist the template');
  }
  expect(createdTemplate.planningTips).toBe(planningTips);

  const registrationOptions =
    await database.query.templateRegistrationOptions.findMany({
      where: { templateId: createdTemplate.id },
    });
  const participantRegistrationOption = registrationOptions.find(
    (option) => !option.organizingRegistration,
  );
  if (!participantRegistrationOption) {
    throw new Error('Expected participant registration option to be persisted');
  }

  const addOn = await database.query.templateEventAddons.findFirst({
    where: {
      templateId: createdTemplate.id,
      title: addOnTitle,
    },
  });
  expect(addOn).toEqual(
    expect.objectContaining({
      allowPurchaseDuringRegistration: true,
      description: addOnDescription,
      isPaid: false,
      maxQuantityPerUser: 3,
      price: 0,
      totalAvailableQuantity: 12,
    }),
  );
  if (!addOn) {
    throw new Error('Expected reusable add-on to be persisted');
  }

  const addOnAttachment =
    await database.query.addonToTemplateRegistrationOptions.findFirst({
      where: {
        addonId: addOn.id,
        registrationOptionId: participantRegistrationOption.id,
      },
    });
  if (!addOnAttachment) {
    throw new Error('Expected reusable add-on registration option attachment');
  }
  expect(addOnAttachment).toEqual(
    expect.objectContaining({
      quantity: 2,
    }),
  );

  const question = await database.query.templateRegistrationQuestions.findFirst(
    {
      where: {
        registrationOptionId: participantRegistrationOption.id,
        templateId: createdTemplate.id,
        title: questionTitle,
      },
    },
  );
  if (!question) {
    throw new Error('Expected reusable registration question to be persisted');
  }
  expect(question).toEqual(
    expect.objectContaining({
      description: questionDescription,
      required: true,
    }),
  );
});

test('view a template', async ({ page, templates }) => {
  const template = templates[0];
  if (!template) {
    throw new Error('Expected seeded template before template detail view');
  }
  await page.goto('.');
  await page.getByRole('link', { name: 'Templates' }).click();
  await expect(page).toHaveURL(/\/templates/);
  await page.getByRole('link', { name: template.title }).click();
  await expect(page).toHaveURL(`/templates/${template.id}`);
});

test('template create form hides selected roles in autocomplete', async ({
  page,
}) => {
  await page.goto('.');
  await page.getByRole('link', { name: 'Templates' }).click();
  await expect(page).toHaveURL(/\/templates/);
  await page.getByRole('link', { name: 'Create template' }).click();
  await expect(page).toHaveURL('/templates/create');

  const organizerRoleInput = page.getByPlaceholder('Add Role...').first();
  await organizerRoleInput.click();

  const roleOptions = page.locator('mat-option');
  const optionsCount = await roleOptions.count();
  if (optionsCount === 0) {
    throw new Error('Expected seeded roles for template autocomplete');
  }

  const firstOption = roleOptions.first();
  const firstRoleText = await firstOption.textContent();
  const selectedRoleName = firstRoleText?.trim();
  if (!selectedRoleName) {
    throw new Error('Expected template autocomplete option to have role text');
  }

  await firstOption.click();

  await organizerRoleInput.click();
  await expect(
    page.getByRole('option', {
      exact: true,
      name: selectedRoleName,
    }),
  ).toHaveCount(0);
});
