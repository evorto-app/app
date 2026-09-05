import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('platform event question history source', () => {
  it('uses the shared answered-question guard for platform event edits', () => {
    const eventSource = readFileSync(
      new URL('platform-events.handlers.ts', import.meta.url),
      'utf8',
    );

    expect(eventSource).toContain(
      'yield* ensureAnsweredEventQuestionsUnchanged(database',
    );
    expect(eventSource).toContain('...normalizeEventQuestionValues(question)');
    expect(eventSource).toContain(
      'const values = normalizeEventQuestionValues(question)',
    );
    expect(eventSource).not.toContain('eventRegistrationQuestionAnswers');
  });
});
