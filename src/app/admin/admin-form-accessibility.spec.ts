import { readFileSync } from 'node:fs';
import nodePath from 'node:path';
import { describe, expect, it } from 'vitest';

const iconControlLabels = [
  {
    labels: ['Back to roles'],
    path: 'src/app/admin/role-create/role-create.component.html',
  },
  {
    labels: ['Back to roles', 'Edit role'],
    path: 'src/app/admin/role-details/role-details.component.html',
  },
  {
    labels: ['Back to role'],
    path: 'src/app/admin/role-edit/role-edit.component.html',
  },
  {
    labels: ['Back to administration'],
    path: 'src/app/admin/role-list/role-list.component.html',
  },
  {
    labels: ['Back to administration'],
    path: 'src/app/admin/user-list/user-list.component.html',
  },
  {
    labels: ['Back to administration'],
    path: 'src/app/admin/settings/appearance-settings.component.html',
  },
  {
    labels: ['Back to administration'],
    path: 'src/app/admin/settings/legal-settings.component.html',
  },
  {
    labels: ['Back to administration'],
    path: 'src/app/admin/settings/organization-settings.component.html',
  },
  {
    labels: ['Back to administration'],
    path: 'src/app/admin/settings/payment-provider-settings.component.html',
  },
  {
    labels: ['Back to administration'],
    path: 'src/app/admin/settings/registration-settings.component.html',
  },
  {
    labels: ['Back to organizations'],
    path: 'src/app/global-admin/tenant-detail/tenant-detail.component.html',
  },
  {
    labels: ['Back to organization'],
    path: 'src/app/global-admin/tenant-edit/tenant-edit.component.html',
  },
  {
    labels: ['Back to templates'],
    path: 'src/app/templates/categories/category-list/category-list.component.html',
  },
  {
    labels: ['Back to templates', 'Open template actions'],
    path: 'src/app/templates/template-details/template-details.component.html',
  },
  {
    labels: ['Open template list actions'],
    path: 'src/app/templates/template-list/template-list.component.html',
  },
] as const;

describe('icon-only admin controls', () => {
  it.each(iconControlLabels)(
    'gives the controls in $path accessible names',
    ({ labels, path }) => {
      const template = readFileSync(nodePath.join(process.cwd(), path), 'utf8');

      for (const label of labels) {
        expect(template).toContain(`aria-label="${label}"`);
      }
    },
  );
});

describe('regular role write failures', () => {
  it.each([
    {
      expectedTags: ['RoleNameAlreadyExistsError', 'RoleWriteValidationError'],
      fallback: 'The role could not be created. Try again.',
      path: 'src/app/admin/role-create/role-create.component.ts',
      unexpectedTags: ['AdminRoleNotFoundError', 'RpcBadRequestError'],
    },
    {
      expectedTags: [
        'RoleNameAlreadyExistsError',
        'RoleWriteValidationError',
        'AdminRoleNotFoundError',
        'RpcBadRequestError',
      ],
      fallback: 'The role could not be updated. Try again.',
      path: 'src/app/admin/role-edit/role-edit.component.ts',
      unexpectedTags: [],
    },
  ])(
    'allows only expected role write outcomes from $path',
    ({ expectedTags, fallback, path, unexpectedTags }) => {
      const source = readFileSync(nodePath.join(process.cwd(), path), 'utf8');

      expect(source).toContain('onError: (error) =>');
      expect(source).toContain('this.notifications.showError(');
      expect(source).toContain(`'${fallback}'`);
      for (const tag of expectedTags) {
        expect(source).toContain(`'${tag}'`);
      }
      for (const tag of unexpectedTags) {
        expect(source).not.toContain(`'${tag}'`);
      }
      expect(source).not.toContain("'RpcForbiddenError'");
      expect(source).not.toContain("'RpcInternalServerError'");
      expect(source).not.toContain("'RpcUnauthorizedError'");
    },
  );
});

describe('admin load recovery', () => {
  it.each([
    {
      failure: "We couldn't load this role.",
      loading: 'Loading role…',
      path: 'src/app/admin/role-details/role-details.component.html',
      query: 'roleQuery',
    },
    {
      failure: "We couldn't load this role.",
      loading: 'Loading role…',
      path: 'src/app/admin/role-edit/role-edit.component.html',
      query: 'roleQuery',
    },
    {
      failure: "We couldn't load the roles.",
      loading: 'Loading roles…',
      path: 'src/app/admin/role-list/role-list.component.html',
      query: 'roleQuery',
    },
    {
      failure: "We couldn't load the tax rates.",
      loading: 'Loading tax rates…',
      path: 'src/app/admin/tax-rates-settings/tax-rates-settings.component.ts',
      query: 'importedQuery',
    },
  ])(
    'pairs the visible $path failure with a real retry action',
    ({ failure, loading, path, query }) => {
      const source = readFileSync(nodePath.join(process.cwd(), path), 'utf8');

      expect(source).toContain(loading);
      expect(source).toContain(failure);
      expect(source).toContain(`(click)="${query}.refetch()"`);
      expect(source).toContain(`[disabled]="${query}.isFetching()"`);
      expect(source).toContain('Trying again…');
    },
  );
});

describe('plain administrator copy', () => {
  it('keeps implementation wording and misleading fallbacks out of settings', () => {
    const organizationTemplate = readFileSync(
      nodePath.join(
        process.cwd(),
        'src/app/admin/settings/organization-settings.component.html',
      ),
      'utf8',
    ).replaceAll(/\s+/gu, ' ');
    const legalTemplate = readFileSync(
      nodePath.join(
        process.cwd(),
        'src/app/admin/settings/legal-settings.component.html',
      ),
      'utf8',
    ).replaceAll(/\s+/gu, ' ');
    const paymentTemplate = readFileSync(
      nodePath.join(
        process.cwd(),
        'src/app/admin/settings/payment-provider-settings.component.html',
      ),
      'utf8',
    );
    const organizationSource = readFileSync(
      nodePath.join(
        process.cwd(),
        'src/app/admin/settings/organization-settings.component.ts',
      ),
      'utf8',
    );
    const paymentSource = readFileSync(
      nodePath.join(
        process.cwd(),
        'src/app/admin/settings/payment-provider-settings.component.ts',
      ),
      'utf8',
    );

    expect(organizationTemplate).toContain(
      'Replies to emails from Evorto go to the details below.',
    );
    expect(organizationTemplate).not.toContain(
      'Evorto sends the original email',
    );
    expect(legalTemplate).toContain(
      'your public pages link to the other website',
    );
    expect(legalTemplate).not.toContain('public footer');
    expect(paymentTemplate).toContain('Allow receipts from other countries');
    expect(organizationSource).not.toContain('Reloading to apply');
    expect(paymentSource).not.toContain('Reloading to apply');
  });
});
