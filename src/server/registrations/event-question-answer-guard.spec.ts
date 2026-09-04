import { Database } from '@db/index';
import { describe, expect, it } from '@effect/vitest';
import { RpcBadRequestError } from '@shared/errors/rpc-errors';
import { Effect } from 'effect';

import { createRegistrationDatabaseTestLayer } from '../testing/registration-database';
import {
  answeredEventQuestionMutationError,
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

  it.each([
    ['saved registration answers', true, false],
    ['saved transfer answers', false, true],
  ])(
    'rejects changes with %s',
    (_name, hasRegistrationAnswers, hasTransferAnswers) => {
      expect(
        answeredEventQuestionMutationError({
          hasRegistrationAnswers,
          hasTransferAnswers,
        }),
      ).toMatchObject({
        _tag: 'RpcBadRequestError',
        message:
          'Questions with saved answers cannot be changed or removed. Add a new question instead.',
        reason: 'eventQuestionInUse',
      });
    },
  );

  it('allows changes when no saved answers exist', () => {
    expect(
      answeredEventQuestionMutationError({
        hasRegistrationAnswers: false,
        hasTransferAnswers: false,
      }),
    ).toBeUndefined();
  });
});

describe('answered event question history database guard', () => {
  const unexpectedQueries: string[] = [];

  it.layer(
    createRegistrationDatabaseTestLayer({
      executeValues: (statement) =>
        Effect.sync(() => {
          unexpectedQueries.push(statement);
          throw new Error(`Unexpected unchanged-question SQL: ${statement}`);
        }),
    }),
  )('unchanged questions', (it) => {
    it.effect('does not query either answer history', () =>
      Effect.gen(function* () {
        const database = yield* Database;
        const result = yield* ensureAnsweredEventQuestionsUnchanged(database, {
          before: [question],
          submitted: [{ ...question }],
        });

        expect(result).toBeUndefined();
        expect(unexpectedQueries).toEqual([]);
      }),
    );
  });

  for (const mutation of [
    {
      name: 'changed question',
      submitted: [{ ...question, title: 'Changed' }],
    },
    { name: 'removed question', submitted: [] },
  ]) {
    for (const history of [
      {
        hasRegistrationAnswers: true,
        hasTransferAnswers: false,
        name: 'saved registration answers only',
      },
      {
        hasRegistrationAnswers: false,
        hasTransferAnswers: true,
        name: 'saved transfer answers only',
      },
      {
        hasRegistrationAnswers: true,
        hasTransferAnswers: true,
        name: 'both saved answer histories',
      },
      {
        hasRegistrationAnswers: false,
        hasTransferAnswers: false,
        name: 'neither saved answer history',
      },
    ]) {
      const queriedTables: string[] = [];
      const databaseLayer = createRegistrationDatabaseTestLayer({
        executeValues: (statement, parameters) =>
          Effect.sync(() => {
            expect(parameters).toEqual(['question-1', 1]);
            switch (statement) {
              case 'select "id" from "event_registration_question_answers" where "event_registration_question_answers"."questionId" in ($1) limit $2': {
                queriedTables.push('registration answers');
                return history.hasRegistrationAnswers
                  ? [['registration-answer-1']]
                  : [];
              }
              case 'select "id" from "registration_transfer_answers" where "registration_transfer_answers"."question_id" in ($1) limit $2': {
                queriedTables.push('transfer answers');
                return history.hasTransferAnswers
                  ? [['transfer-answer-1']]
                  : [];
              }
              default: {
                throw new Error(
                  `Unexpected question-history SQL: ${statement}`,
                );
              }
            }
          }),
      });

      it.layer(databaseLayer)(`${mutation.name}: ${history.name}`, (it) => {
        it.effect(
          'checks both histories before deciding whether to allow the mutation',
          () =>
            Effect.gen(function* () {
              const database = yield* Database;
              const guard = ensureAnsweredEventQuestionsUnchanged(database, {
                before: [question],
                submitted: mutation.submitted,
              });

              if (
                history.hasRegistrationAnswers ||
                history.hasTransferAnswers
              ) {
                const error = yield* Effect.flip(guard);
                expect(error).toBeInstanceOf(RpcBadRequestError);
                expect(error).toMatchObject({
                  _tag: 'RpcBadRequestError',
                  message:
                    'Questions with saved answers cannot be changed or removed. Add a new question instead.',
                  reason: 'eventQuestionInUse',
                });
              } else {
                const result = yield* guard;
                expect(result).toBeUndefined();
              }

              expect(queriedTables).toHaveLength(2);
              expect(queriedTables).toEqual(
                expect.arrayContaining([
                  'registration answers',
                  'transfer answers',
                ]),
              );
            }),
        );
      });
    }
  }
});
