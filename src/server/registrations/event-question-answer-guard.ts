import { RpcBadRequestError } from '@shared/errors/rpc-errors';
import { and, eq, inArray } from 'drizzle-orm';
import { Effect } from 'effect';

import type { DatabaseClient } from '../../db';

import {
  eventInstances,
  eventRegistrationQuestionAnswers,
  eventRegistrationQuestions,
  registrationTransferAnswers,
  tenants,
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

export const answeredEventQuestionMutationError = ({
  hasRegistrationAnswers,
  hasTransferAnswers,
}: {
  readonly hasRegistrationAnswers: boolean;
  readonly hasTransferAnswers: boolean;
}): RpcBadRequestError | undefined =>
  hasRegistrationAnswers || hasTransferAnswers
    ? new RpcBadRequestError({
        message:
          'Questions with saved answers cannot be changed or removed. Add a new question instead.',
        reason: 'eventQuestionInUse',
      })
    : undefined;

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

  // FK answer inserts retain KEY SHARE until commit. Lock first so a writer
  // that wins the race commits before the history queries take their snapshot.
  yield* database
    .select({ id: eventRegistrationQuestions.id })
    .from(eventRegistrationQuestions)
    .where(inArray(eventRegistrationQuestions.id, [...mutationIds]))
    .orderBy(eventRegistrationQuestions.id)
    .for('update')
    .pipe(Effect.orDie);

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
  const error = answeredEventQuestionMutationError({
    hasRegistrationAnswers: registrationAnswers.length > 0,
    hasTransferAnswers: transferAnswers.length > 0,
  });
  if (error) return yield* Effect.fail(error);
});

/** Must run in the answer-writing transaction, before locking its option. */
export const lockEventRegistrationQuestionSet = Effect.fn(
  'EventQuestions.lockEventRegistrationQuestionSet',
)(function* (
  database: Pick<DatabaseClient, 'select'>,
  input: {
    readonly eventId: string;
    readonly registrationOptionId: string;
    readonly tenantId: string;
  },
) {
  // Answer inserts also acquire a tenant FK lock. Take it before the event
  // lock, matching editors and transfer claims that lock tenant before event.
  const tenantRows = yield* database
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.id, input.tenantId))
    .for('key share');
  if (tenantRows.length !== 1) return;

  // Both event editors hold UPDATE on this row before reading the graph.
  // SHARE protects the complete set, including newly added required questions.
  const events = yield* database
    .select({ id: eventInstances.id })
    .from(eventInstances)
    .where(
      and(
        eq(eventInstances.id, input.eventId),
        eq(eventInstances.tenantId, input.tenantId),
      ),
    )
    .for('share');
  if (events.length !== 1) return;

  return yield* database
    .select({
      id: eventRegistrationQuestions.id,
      required: eventRegistrationQuestions.required,
    })
    .from(eventRegistrationQuestions)
    .where(
      and(
        eq(eventRegistrationQuestions.eventId, input.eventId),
        eq(
          eventRegistrationQuestions.registrationOptionId,
          input.registrationOptionId,
        ),
      ),
    )
    .orderBy(eventRegistrationQuestions.id)
    .for('share');
});
