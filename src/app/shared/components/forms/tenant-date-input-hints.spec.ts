import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const readTemplate = (templatePath: string): string =>
  readFileSync(path.join(process.cwd(), templatePath), 'utf8');

describe('tenant date input hints', () => {
  it('uses the fixed de-DE calendar format on event scheduling forms', () => {
    for (const templatePath of [
      'src/app/shared/components/forms/event-general-form/event-general-form.html',
      'src/app/shared/components/forms/registration-option-form/registration-option-form.html',
    ]) {
      const template = readTemplate(templatePath);
      expect(template).toContain('DD.MM.YYYY');
      expect(template).not.toContain('MM/DD/YYYY');
    }
  });
});
