import { readFileSync } from 'node:fs';
import nodePath from 'node:path';
import { describe, expect, it } from 'vitest';

const readTemplateSource = (relativePath: string): string =>
  readFileSync(
    nodePath.join(process.cwd(), 'src/app/templates', relativePath),
    'utf8',
  );

describe('template authoring provider failures', () => {
  it.each([
    [
      'template-create/template-create.component.ts',
      'template-create/template-create.component.html',
    ],
    [
      'template-edit/template-edit.component.ts',
      'template-edit/template-edit.component.html',
    ],
  ])(
    'preserves paid graphs and blocks %s until provider data is available',
    (sourcePath, templatePath) => {
      const source = readTemplateSource(sourcePath);
      const template = readTemplateSource(templatePath);

      expect(source).toContain('authoringProvidersReady');
      expect(source).toContain('paidGraphBlocked');
      expect(source).not.toContain('resetTemplateGraphPayments');
      expect(template).toContain('Discount settings could not be loaded.');
      expect(template).toContain('Tax rates could not be loaded.');
      expect(template).toContain('Roles could not be loaded.');
      expect(template).toContain('discountProvidersQuery.refetch()');
      expect(template).toContain('taxRatesQuery.refetch()');
      expect(template).toContain('rolesQuery.refetch()');
      expect(template).not.toContain('taxRatesQuery.data() ?? []');
      expect(source).toContain('roles.findMany.queryOptions({})');
      expect(source).not.toContain(
        'roles.findMany.queryOptions({ defaultUserRole: true })',
      );
    },
  );
});
