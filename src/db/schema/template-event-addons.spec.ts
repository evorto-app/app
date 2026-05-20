import { describe, expect, it } from '@effect/vitest';
import { readFileSync } from 'node:fs';

const readSource = (path: string) =>
  readFileSync(new URL(path, import.meta.url), 'utf8');

describe('template event add-on schema', () => {
  it('exposes template add-ons and copied event add-on storage', () => {
    const schemaIndexSource = readSource('index.ts');
    const eventAddonSource = readSource('event-addons.ts');
    const templateAddonSource = readSource('template-event-addons.ts');

    expect(schemaIndexSource).toContain(
      "export * from './template-event-addons'",
    );
    expect(schemaIndexSource).toContain("export * from './event-addons'");
    expect(templateAddonSource).toContain("pgTable('template_event_addons'");
    expect(eventAddonSource).toContain("pgTable('event_addons'");
    expect(eventAddonSource).toContain("'addon_to_event_registration_options'");
  });

  it('exposes template and event registration-question storage', () => {
    const schemaIndexSource = readSource('index.ts');
    const eventQuestionSource = readSource('event-registration-questions.ts');
    const questionSource = readSource('template-registration-questions.ts');

    expect(schemaIndexSource).toContain(
      "export * from './template-registration-questions'",
    );
    expect(schemaIndexSource).toContain(
      "export * from './event-registration-questions'",
    );
    expect(questionSource).toContain("'template_registration_questions'");
    expect(eventQuestionSource).toContain("'event_registration_questions'");
    expect(eventQuestionSource).toContain('sourceTemplateQuestionId');
  });
});
