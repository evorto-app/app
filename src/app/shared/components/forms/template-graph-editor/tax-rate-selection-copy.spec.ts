import { readFileSync } from 'node:fs';
import nodePath from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (sourcePath: string): string =>
  readFileSync(nodePath.join(process.cwd(), sourcePath), 'utf8');

const taxRateSelectorTemplates = [
  'src/app/events/event-edit/event-addon-editor.html',
  'src/app/events/event-edit/event-registration-option-editor.html',
  'src/app/shared/components/forms/registration-option-form/registration-option-form.html',
  'src/app/shared/components/forms/template-graph-editor/template-addon-editor.component.html',
  'src/app/shared/components/forms/template-graph-editor/template-registration-option-editor.component.html',
  'src/app/global-admin/platform-event-operations/platform-event-detail.component.html',
] as const;

describe('tax-rate selection copy', () => {
  it.each(taxRateSelectorTemplates)(
    'blocks rates without a percentage and explains the missing detail in %s',
    (sourcePath) => {
      const template = readSource(sourcePath);

      expect(template).toContain('[disabled]="rate.percentage === null"');
      expect(template).toContain('Tax rate percentage unavailable');
      expect(template).not.toContain('rate.percentage ?? "?"');
      expect(template).not.toContain(
        'rate.displayName || rate.stripeTaxRateId',
      );
    },
  );

  it('keeps provider references out of the platform import selector', () => {
    const template = readSource(
      'src/app/global-admin/platform-tenant-admin/platform-tax-rates.component.html',
    );

    expect(template).toContain(
      'Percentage unavailable; this rate cannot be imported',
    );
    expect(template).not.toContain('rate.displayName || rate.id');
    expect(template).not.toContain('{{ rate.id }}');
  });

  it('marks incomplete imported rates as unavailable instead of presenting a null percentage', () => {
    const settings = readSource(
      'src/app/admin/tax-rates-settings/tax-rates-settings.component.ts',
    );
    const importDialog = readSource(
      'src/app/admin/components/import-tax-rates-dialog/import-tax-rates-dialog.component.html',
    );

    expect(settings).toContain('Percentage unavailable');
    expect(settings).toContain('rate.percentage === null');
    expect(importDialog).toContain('rate.percentage === null');
    expect(importDialog).toContain('Percentage missing');
  });

  it('blocks incomplete rates in the platform template editor', () => {
    const source = readSource(
      'src/app/global-admin/platform-event-operations/platform-template-editor.component.ts',
    );
    const template = readSource(
      'src/app/global-admin/platform-event-operations/platform-template-editor.component.html',
    );

    expect(
      template.match(/\[disabled\]="rate\.percentage === null"/g),
    ).toHaveLength(2);
    expect(source).toContain(
      'Percentage unavailable; this rate cannot be selected',
    );
  });
});
