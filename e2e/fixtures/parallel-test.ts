import { addTemplateCategories } from '../../helpers/add-template-categories';
import { addTemplates } from '../../helpers/add-templates';
import { createTenant } from '../../helpers/create-tenant';
import { test as base } from './base-test';

interface BaseFixtures {
  templateCategories: {
    id: string;
    tenantId: string;
    title: string;
  }[];
  templates: {
    id: string;
    title: string;
  }[];
  tenant: {
    domain: string;
    id: string;
    name: string;
  };
}

export const test = base.extend<BaseFixtures>({
  context: async ({ context, tenant }, use) => {
    await context.addCookies([
      {
        domain: 'localhost',
        expires: -1,
        name: 'evorto-tenant',
        path: '/',
        value: tenant.domain,
      },
    ]);
    await use(context);
  },
  templateCategories: async ({ database, tenant }, use) => {
    const templateCategories = await addTemplateCategories(database, tenant);
    await use(templateCategories);
  },
  templates: async ({ database, templateCategories }, use) => {
    const templates = await addTemplates(database, templateCategories);
    await use(templates);
  },
  tenant: async ({ database }, use) => {
    const tenant = await createTenant(database);
    await use(tenant);
  },
});
export { expect } from '@playwright/test';
