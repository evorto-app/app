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
  await page.goto(`/templates/create/${category.id}`);
  await fillTemplateBasics(page, {
    title: templateTitle,
  });
  await page.getByRole('button', { name: 'Save template' }).click();
  await expect(page).toHaveURL(/\/templates\/(?!create(?:\/|$))[^/]+$/, {
    timeout: 15_000,
  });
  await expect(page.getByRole('link', { name: templateTitle })).toBeVisible();
});

test('add a valid template icon and explain invalid icon names', async ({
  database,
  page,
  templateCategories,
  tenant,
}) => {
  const category = templateCategories[0];
  if (!category) {
    throw new Error('Expected seeded template category before icon selection');
  }

  await page.goto(`/templates/create/${category.id}`);
  const changeIconButton = page.getByRole('button', { name: 'Change Icon' });
  await expect(changeIconButton).not.toHaveAttribute('jsaction', /click/);
  await changeIconButton.click();
  const iconDialog = page.locator('app-icon-selector-dialog');
  const searchInput = iconDialog.getByLabel('Search');

  await searchInput.fill('invalid/icon');
  await expect(
    iconDialog.getByText('To add an Icons8 icon, use a lowercase name'),
  ).toBeVisible();
  await expect(iconDialog.getByTestId('direct-access-icon')).toBeHidden();

  const iconName = `security-icon-${getId().slice(0, 6).toLowerCase()}`;
  await searchInput.fill(iconName);
  const directAccessIcon = iconDialog.getByTestId('direct-access-icon');
  await expect(directAccessIcon).toBeVisible();

  await database.insert(schema.icons).values({
    commonName: iconName,
    friendlyName: 'Security Icon',
    sourceColor: 0,
    tenantId: tenant.id,
  });

  const addRequestPromise = page.waitForRequest((request) => {
    const rpcPath = new URL(request.url()).pathname.replace(/\/+$/, '');
    return (
      rpcPath === '/rpc' &&
      request.postData()?.includes('"tag":"icons.add"') === true
    );
  });
  await directAccessIcon.click();
  const addRequest = await addRequestPromise;
  const requestBody: unknown = JSON.parse(addRequest.postData() ?? 'null');
  const messages = Array.isArray(requestBody) ? requestBody : [requestBody];
  const addMessage = messages.find(
    (message) =>
      message !== null &&
      typeof message === 'object' &&
      Reflect.get(message, 'tag') === 'icons.add',
  );

  expect(addMessage).toBeDefined();
  expect(Reflect.get(addMessage ?? {}, 'payload')).toMatchObject({
    icon: iconName,
    usage: { _tag: 'templateCreate' },
  });
  await expect(iconDialog).toBeHidden();
  await expect(page.getByAltText(iconName)).toBeVisible();
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
  await page.goto(`/templates/create/${category.id}`);

  await fillTemplateBasics(page, {
    title: templateTitle,
  });
  await page.getByLabel('Organizer planning tips').fill(planningTips);

  await page
    .getByRole('button', { name: 'Use advanced configuration' })
    .click();
  await expect(
    page.getByRole('heading', {
      name: 'Switch to advanced configuration?',
    }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Switch to advanced', exact: true })
    .click();

  await page.getByRole('button', { name: 'Add add-on' }).click();
  const addOnEditor = page.locator('app-template-addon-editor').first();
  await addOnEditor.getByLabel('Add-on name').fill(addOnTitle);
  await addOnEditor.getByLabel('Description').fill(addOnDescription);
  await addOnEditor
    .getByRole('combobox', { name: 'Registration option', exact: true })
    .click();
  await page
    .getByRole('option', { name: 'Participant registration', exact: true })
    .click();
  await addOnEditor.getByLabel('Included quantity').fill('2');
  await addOnEditor.getByLabel('Optional purchase quantity').fill('0');
  await addOnEditor.getByLabel('Available quantity').fill('12');
  await addOnEditor.getByLabel('Maximum per user').fill('3');

  await page.getByRole('button', { name: 'Add question' }).click();
  const questionEditor = page.locator('app-template-question-editor').first();
  await questionEditor
    .getByRole('textbox', { name: 'Question', exact: true })
    .fill(questionTitle);
  await questionEditor.getByLabel('Ask during').click();
  await page
    .getByRole('option', { name: 'Participant registration', exact: true })
    .click();
  await questionEditor.getByLabel('Help text').fill(questionDescription);

  await page.getByRole('button', { name: 'Save template' }).click();
  await expect(page).toHaveURL(/\/templates\/(?!create(?:\/|$))[^/]+$/, {
    timeout: 15_000,
  });
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
      includedQuantity: 2,
      optionalPurchaseQuantity: 0,
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
  await page.goto('/templates/create');
  await expect(page).toHaveURL('/templates/create');

  const organizerRoleInput = page.getByPlaceholder('Add Role...').first();
  await expect(organizerRoleInput).not.toHaveClass(/mat-input-server/);
  const roleOptions = page.locator('mat-option');
  await expect(async () => {
    await organizerRoleInput.fill('a');
    await expect(organizerRoleInput).toHaveValue('a');
    await expect(roleOptions.first()).toBeVisible();
  }).toPass({ timeout: 15_000 });

  const firstOption = roleOptions.first();
  const firstRoleText = await firstOption.textContent();
  const selectedRoleName = firstRoleText?.trim();
  if (!selectedRoleName) {
    throw new Error('Expected template autocomplete option to have role text');
  }

  await firstOption.click();

  const selectedRoleOption = page.getByRole('option', {
    exact: true,
    name: selectedRoleName,
  });
  await expect(async () => {
    await organizerRoleInput.fill(selectedRoleName);
    await expect(organizerRoleInput).toHaveValue(selectedRoleName);
    await expect(selectedRoleOption).toHaveCount(0);
  }).toPass({ timeout: 15_000 });
});
