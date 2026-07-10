import { describe, expect, it } from '@effect/vitest';
import { readFileSync } from 'node:fs';

const readSource = (path: string) =>
  readFileSync(new URL(path, import.meta.url), 'utf8');

describe('template event add-on schema', () => {
  it('exposes template add-ons and copied event add-on storage', () => {
    const addonPurchaseSource = readSource(
      'event-registration-addon-purchases.ts',
    );
    const schemaIndexSource = readSource('index.ts');
    const eventAddonSource = readSource('event-addons.ts');
    const templateAddonSource = readSource('template-event-addons.ts');
    const templateOptionSource = readSource('template-registration-options.ts');

    expect(schemaIndexSource).toContain(
      "export * from './template-event-addons'",
    );
    expect(schemaIndexSource).toContain("export * from './event-addons'");
    expect(schemaIndexSource).toContain(
      "export * from './event-registration-addon-purchases'",
    );
    expect(templateAddonSource).toContain("'template_event_addons'");
    expect(templateAddonSource).toContain(
      'templateAddonTemplateIdentityUniqueConstraintName',
    );
    expect(eventAddonSource).toContain("'event_addons'");
    expect(eventAddonSource).toContain("'addon_to_event_registration_options'");
    expect(eventAddonSource).toContain('includedQuantity');
    expect(eventAddonSource).toContain('optionalPurchaseQuantity');
    expect(eventAddonSource).toContain('eventId: varchar');
    expect(templateOptionSource).toContain(
      "'addon_to_template_registration_options'",
    );
    expect(templateOptionSource).toContain('includedQuantity');
    expect(templateOptionSource).toContain('optionalPurchaseQuantity');
    expect(templateOptionSource).toContain('templateId: varchar');
    expect(addonPurchaseSource).toContain(
      "'event_registration_addon_purchases'",
    );
  });

  it('exposes template and event registration-question storage', () => {
    const answerSource = readSource('event-registration-question-answers.ts');
    const schemaIndexSource = readSource('index.ts');
    const eventQuestionSource = readSource('event-registration-questions.ts');
    const questionSource = readSource('template-registration-questions.ts');

    expect(schemaIndexSource).toContain(
      "export * from './template-registration-questions'",
    );
    expect(schemaIndexSource).toContain(
      "export * from './event-registration-questions'",
    );
    expect(schemaIndexSource).toContain(
      "export * from './event-registration-question-answers'",
    );
    expect(questionSource).toContain("'template_registration_questions'");
    expect(eventQuestionSource).toContain("'event_registration_questions'");
    expect(eventQuestionSource).toContain('sourceTemplateQuestionId');
    expect(answerSource).toContain("'event_registration_question_answers'");
    expect(answerSource).toContain('uniqueRegistrationQuestionAnswer');
  });
});
