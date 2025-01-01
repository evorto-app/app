import { createTenant } from '../../helpers/create-tenant';
import { test as base } from './base-test';

interface BaseFixtures {
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
  tenant: async ({ database }, use) => {
    const tenant = await createTenant(database);
    await use(tenant);
  },
});
export { expect } from '@playwright/test';
