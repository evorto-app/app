import { Effect } from 'effect';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import type { DatabaseClient } from '../../db';

import {
  eventRegistrationQuestionAnswers,
  registrationTransferAnswers,
} from '../../db/schema';
import {
  ensureAnsweredEventQuestionsUnchanged,
  eventQuestionHistoryMutationIds,
  type EventQuestionHistoryShape,
  normalizeEventQuestionValues,
} from './event-question-answer-guard';

const question: EventQuestionHistoryShape = {
  description: 'Shown before registration',
  id: 'question-1',
  registrationOptionId: 'option-1',
  required: false,
  sortOrder: 0,
  title: 'Dietary requirements',
};

describe('answered event question history guard', () => {
  it('treats unchanged normalized questions as historical no-ops', () => {
    expect(
      eventQuestionHistoryMutationIds({
        before: [question],
        submitted: [
          {
            ...question,
            description: 'Shown before registration',
            title: 'Dietary requirements',
          },
        ],
      }),
    ).toEqual([]);
    expect(
      normalizeEventQuestionValues({
        ...question,
        description: '  Shown before registration  ',
        title: '  Dietary requirements  ',
      }),
    ).toEqual({
      description: 'Shown before registration',
      registrationOptionId: 'option-1',
      required: false,
      sortOrder: 0,
      title: 'Dietary requirements',
    });
  });

  it.each([
    ['description', { description: 'Changed' }],
    ['registration option', { registrationOptionId: 'option-2' }],
    ['requiredness', { required: true }],
    ['sort order', { sortOrder: 1 }],
    ['title', { title: 'Changed' }],
  ])('protects answered question %s changes', (_name, change) => {
    expect(
      eventQuestionHistoryMutationIds({
        before: [question],
        submitted: [{ ...question, ...change }],
      }),
    ).toEqual(['question-1']);
  });

  it('protects removal while ignoring new questions', () => {
    expect(
      eventQuestionHistoryMutationIds({
        before: [question],
        submitted: [
          {
            ...question,
            id: 'question-new',
          },
        ],
      }),
    ).toEqual(['question-1']);
  });

  it('protects answers submitted for a pending registration transfer', async () => {
    const selectedTables: unknown[] = [];
    const database = {
      select: () => ({
        from: (table: unknown) => {
          selectedTables.push(table);
          return {
            where: () => ({
              limit: () =>
                Effect.succeed(
                  table === registrationTransferAnswers
                    ? [{ id: 'transfer-answer-1' }]
                    : [],
                ),
            }),
          };
        },
      }),
    } as Pick<DatabaseClient, 'select'>;

    const error = await Effect.runPromise(
      ensureAnsweredEventQuestionsUnchanged(database, {
        before: [question],
        submitted: [{ ...question, required: true }],
      }).pipe(Effect.flip),
    );

    expect(error).toMatchObject({
      _tag: 'RpcBadRequestError',
      message:
        'Questions with saved answers cannot be changed or removed. Add a new question instead.',
      reason: 'eventQuestionInUse',
    });
    expect(selectedTables).toEqual([
      eventRegistrationQuestionAnswers,
      registrationTransferAnswers,
    ]);
  });

  it('is the single answer-history policy for ordinary and platform event edits', () => {
    const ordinarySource = readFileSync(
      new URL(
        '../effect/rpc/handlers/events/event-graph.service.ts',
        import.meta.url,
      ),
      'utf8',
    );
    const platformSource = readFileSync(
      new URL(
        '../effect/rpc/handlers/platform/platform-events.handlers.ts',
        import.meta.url,
      ),
      'utf8',
    );

    for (const source of [ordinarySource, platformSource]) {
      expect(source).toContain('ensureAnsweredEventQuestionsUnchanged(');
      expect(source).not.toContain(
        "message: 'Answered event questions cannot be removed'",
      );
    }
  });
});
