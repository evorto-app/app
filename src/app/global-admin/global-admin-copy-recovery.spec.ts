import { readFileSync } from 'node:fs';
import nodePath from 'node:path';
import { describe, expect, it } from 'vitest';

const readTemplate = (relativePath: string) =>
  readFileSync(nodePath.join(process.cwd(), relativePath), 'utf8');

describe('global administrator plain-language recovery copy', () => {
  it('offers a real retry action on every organization load error', () => {
    const paths = [
      'src/app/global-admin/tenant-list/tenant-list.component.html',
      'src/app/global-admin/tenant-detail/tenant-detail.component.html',
      'src/app/global-admin/tenant-edit/tenant-edit.component.html',
    ];

    for (const path of paths) {
      const template = readTemplate(path);

      expect(template).toContain('role="alert"');
      expect(template).toContain('(click)="tenantQuery.refetch()"');
      expect(template).toContain('[disabled]="tenantQuery.isFetching()"');
      expect(template).toContain(
        'tenantQuery.isFetching() ? "Trying again…" : "Try again"',
      );
    }
  });

  it('labels tax-rate location in everyday language', () => {
    const template = readTemplate(
      'src/app/global-admin/platform-tenant-admin/platform-tax-rates.component.html',
    );

    expect(template).toContain('Country or region');
    expect(template).not.toContain('>Jurisdiction<');
  });
});
