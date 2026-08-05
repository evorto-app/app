import { describe, expect, it } from '@effect/vitest';
import { readFileSync } from 'node:fs';

const readSiblingSource = (relativePath: string): string =>
  readFileSync(new URL(relativePath, import.meta.url), 'utf8');

const answerInsertBodies = (source: string): string[] =>
  [
    ...source.matchAll(
      /\.insert\(eventRegistrationQuestionAnswers\)\.values\(\s*([\s\S]*?)\n\s*\);/g,
    ),
  ].flatMap((match) => (match[1] ? [match[1]] : []));

describe('registration answer service writes', () => {
  it('persists ordinary registration and waitlist answers with full owner scope', () => {
    const source = readSiblingSource(
      '../effect/rpc/handlers/events/event-registration.service.ts',
    );
    const inserts = answerInsertBodies(source);

    expect(inserts).toHaveLength(2);
    for (const insert of inserts) {
      expect(insert).toContain('eventId,');
      expect(insert).toContain('registrationOptionId: registrationOption.id');
      expect(insert).toContain('tenantId: tenant.id');
    }
  });

  it('persists transfer answers with the transfer owner scope', () => {
    const source = readSiblingSource('./registration-transfer.service.ts');
    const inserts = answerInsertBodies(source);

    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toContain('eventId: transfer.eventId');
    expect(inserts[0]).toContain('registrationOptionId: transfer.optionId');
    expect(inserts[0]).toContain('tenantId: tenant.id');
  });

  it('restores finalized transfer answers with the registration owner scope', () => {
    const source = readSiblingSource('./registration-transfer-finalization.ts');
    const inserts = answerInsertBodies(source);

    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toContain('eventId: transfer.eventId');
    expect(inserts[0]).toContain(
      'registrationOptionId: transfer.registrationOptionId',
    );
    expect(inserts[0]).toContain('tenantId: input.tenantId');
  });
});
