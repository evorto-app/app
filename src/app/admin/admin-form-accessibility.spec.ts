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
      fallback: 'Failed to create role',
      path: 'src/app/admin/role-create/role-create.component.ts',
    },
    {
      fallback: 'Failed to update role',
      path: 'src/app/admin/role-edit/role-edit.component.ts',
    },
  ])('shows the typed error from $path', ({ fallback, path }) => {
    const source = readFileSync(nodePath.join(process.cwd(), path), 'utf8');

    expect(source).toContain('onError: (error) =>');
    expect(source).toContain('this.notifications.showError(');
    expect(source).toContain(`getErrorMessage(error, '${fallback}')`);
  });
});
