import { RpcBadRequestError } from '@shared/errors/rpc-errors';
import { inArray } from 'drizzle-orm';
import { Effect } from 'effect';

import type { DatabaseClient } from '../../db';

import {
  eventRegistrationQuestionAnswers,
  registrationTransferAnswers,
} from '../../db/schema';

export interface EventQuestionHistoryShape {
  readonly description: null | string;
  readonly id: string;
  readonly registrationOptionId: string;
  readonly required: boolean;
  readonly sortOrder: number;
  readonly title: string;
}

export const normalizeEventQuestionValues = (question: {
  readonly description: null | string;
  readonly registrationOptionId: string;
  readonly required: boolean;
  readonly sortOrder: number;
  readonly title: string;
}): Omit<EventQuestionHistoryShape, 'id'> => ({
  description: question.description?.trim() || null,
  registrationOptionId: question.registrationOptionId,
  required: question.required,
  sortOrder: question.sortOrder,
  title: question.title.trim(),
});

export const eventQuestionHistoryMutationIds = ({
  before,
  submitted,
}: {
  readonly before: readonly EventQuestionHistoryShape[];
  readonly submitted: readonly EventQuestionHistoryShape[];
}): readonly string[] => {
  const submittedById = new Map(
    submitted.map((question) => [question.id, question]),
  );

  return before.flatMap((question) => {
    const next = submittedById.get(question.id);
    return !next ||
      (question.description?.trim() || null) !== next.description ||
      question.registrationOptionId !== next.registrationOptionId ||
      question.required !== next.required ||
      question.sortOrder !== next.sortOrder ||
      question.title.trim() !== next.title
      ? [question.id]
      : [];
  });
};

export const ensureAnsweredEventQuestionsUnchanged = Effect.fn(
  'EventQuestions.ensureAnsweredEventQuestionsUnchanged',
)(function* (
  database: Pick<DatabaseClient, 'select'>,
  input: {
    readonly before: readonly EventQuestionHistoryShape[];
    readonly submitted: readonly EventQuestionHistoryShape[];
  },
) {
  const mutationIds = eventQuestionHistoryMutationIds(input);
  if (mutationIds.length === 0) return;

  const [registrationAnswers, transferAnswers] = yield* Effect.all([
    database
      .select({ id: eventRegistrationQuestionAnswers.id })
      .from(eventRegistrationQuestionAnswers)
      .where(
        inArray(eventRegistrationQuestionAnswers.questionId, [...mutationIds]),
      )
      .limit(1)
      .pipe(Effect.orDie),
    database
      .select({ id: registrationTransferAnswers.id })
      .from(registrationTransferAnswers)
      .where(inArray(registrationTransferAnswers.questionId, [...mutationIds]))
      .limit(1)
      .pipe(Effect.orDie),
  ]);
  if (registrationAnswers.length > 0 || transferAnswers.length > 0) {
    return yield* Effect.fail(
      new RpcBadRequestError({
        message:
          'Answered event questions are historical and cannot be changed or removed',
        reason: 'eventQuestionInUse',
      }),
    );
  }
});
