import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { Effect } from 'effect';

import type { DatabaseClient } from '../../db';
import type { TenantOnboardingQuestionType } from '../../shared/rpc-contracts/app-rpcs/onboarding.rpcs';

import {
  tenantOnboardingQuestionAnswers,
  tenantOnboardingQuestions,
  tenantPrivacyPolicyAcceptances,
  tenantPrivacyPolicyVersions,
  tenants,
  users,
  usersToTenants,
} from '../../db/schema';
import {
  TenantOnboardingConfigurationError,
  TenantOnboardingValidationError,
} from '../../shared/rpc-contracts/app-rpcs/onboarding.errors';

export interface NormalizedTenantOnboardingQuestion {
  options: string[];
  prompt: string;
  type: TenantOnboardingQuestionType;
}
export interface NormalizedTenantPrivacyPolicy {
  privacyPolicyText: null | string;
  privacyPolicyUrl: null | string;
}

type TenantOnboardingReadDatabase = Pick<DatabaseClient, 'select'>;

type TenantOnboardingWriteDatabase = Pick<
  DatabaseClient,
  'insert' | 'select' | 'update'
>;

export const tenantOnboardingCompleteFromRecords = (input: {
  answeredQuestionIds: ReadonlySet<string>;
  currentPolicyExists: boolean;
  policyAccepted: boolean;
  questionIds: readonly string[];
}): boolean =>
  input.currentPolicyExists &&
  input.policyAccepted &&
  input.questionIds.every((questionId) =>
    input.answeredQuestionIds.has(questionId),
  );

const currentPolicy = (
  database: TenantOnboardingReadDatabase,
  tenantId: string,
) =>
  database
    .select({
      id: tenantPrivacyPolicyVersions.id,
      privacyPolicyText: tenantPrivacyPolicyVersions.privacyPolicyText,
      privacyPolicyUrl: tenantPrivacyPolicyVersions.privacyPolicyUrl,
      version: tenantPrivacyPolicyVersions.version,
    })
    .from(tenantPrivacyPolicyVersions)
    .where(eq(tenantPrivacyPolicyVersions.tenantId, tenantId))
    .orderBy(desc(tenantPrivacyPolicyVersions.version))
    .limit(1);

const currentQuestions = (
  database: TenantOnboardingReadDatabase,
  tenantId: string,
) =>
  database
    .select({
      id: tenantOnboardingQuestions.id,
      options: tenantOnboardingQuestions.options,
      prompt: tenantOnboardingQuestions.prompt,
      sortOrder: tenantOnboardingQuestions.sortOrder,
      type: tenantOnboardingQuestions.type,
    })
    .from(tenantOnboardingQuestions)
    .where(
      and(
        eq(tenantOnboardingQuestions.tenantId, tenantId),
        isNull(tenantOnboardingQuestions.retiredAt),
      ),
    )
    .orderBy(
      tenantOnboardingQuestions.sortOrder,
      tenantOnboardingQuestions.createdAt,
    );

const latestAnswersByQuestion = Effect.fn('latestAnswersByQuestion')(function* (
  database: TenantOnboardingReadDatabase,
  tenantId: string,
  userId: string,
  questionIds: readonly string[],
) {
  if (questionIds.length === 0) {
    return new Map<string, string>();
  }

  const answers = yield* database
    .select({
      answer: tenantOnboardingQuestionAnswers.answer,
      questionId: tenantOnboardingQuestionAnswers.questionId,
    })
    .from(tenantOnboardingQuestionAnswers)
    .where(
      and(
        eq(tenantOnboardingQuestionAnswers.tenantId, tenantId),
        eq(tenantOnboardingQuestionAnswers.userId, userId),
        inArray(tenantOnboardingQuestionAnswers.questionId, questionIds),
      ),
    )
    .orderBy(desc(tenantOnboardingQuestionAnswers.answeredAt));

  const latest = new Map<string, string>();
  for (const answer of answers) {
    if (!latest.has(answer.questionId)) {
      latest.set(answer.questionId, answer.answer);
    }
  }
  return latest;
});

const hasAcceptedPolicy = Effect.fn('hasAcceptedPolicy')(function* (
  database: TenantOnboardingReadDatabase,
  tenantId: string,
  userId: string,
  policyVersionId: string,
) {
  const rows = yield* database
    .select({ id: tenantPrivacyPolicyAcceptances.id })
    .from(tenantPrivacyPolicyAcceptances)
    .where(
      and(
        eq(tenantPrivacyPolicyAcceptances.tenantId, tenantId),
        eq(tenantPrivacyPolicyAcceptances.userId, userId),
        eq(tenantPrivacyPolicyAcceptances.policyVersionId, policyVersionId),
      ),
    )
    .limit(1);
  return rows.length > 0;
});

export const hasCurrentTenantOnboarding = Effect.fn(
  'hasCurrentTenantOnboarding',
)(function* (
  database: TenantOnboardingReadDatabase,
  input: { tenantId: string; userId: string },
) {
  const policies = yield* currentPolicy(database, input.tenantId);
  const policy = policies[0];
  if (!policy) {
    return false;
  }

  const questions = yield* currentQuestions(database, input.tenantId);
  const [policyAccepted, answers] = yield* Effect.all(
    [
      hasAcceptedPolicy(database, input.tenantId, input.userId, policy.id),
      latestAnswersByQuestion(
        database,
        input.tenantId,
        input.userId,
        questions.map((question) => question.id),
      ),
    ],
    { concurrency: 'unbounded' },
  );

  return tenantOnboardingCompleteFromRecords({
    answeredQuestionIds: new Set(answers.keys()),
    currentPolicyExists: true,
    policyAccepted,
    questionIds: questions.map((question) => question.id),
  });
});

export const resolveTenantOnboardingRequirements = Effect.fn(
  'resolveTenantOnboardingRequirements',
)(function* (
  database: TenantOnboardingReadDatabase,
  input: {
    auth0Id: string;
    tenantId: string;
    tenantName: string;
  },
) {
  const [policies, questions, userRows] = yield* Effect.all(
    [
      currentPolicy(database, input.tenantId),
      currentQuestions(database, input.tenantId),
      database
        .select({
          communicationEmail: users.communicationEmail,
          firstName: users.firstName,
          id: users.id,
          lastName: users.lastName,
        })
        .from(users)
        .where(eq(users.auth0Id, input.auth0Id))
        .limit(1),
    ],
    { concurrency: 'unbounded' },
  );
  const policy = policies[0] ?? null;
  const user = userRows[0] ?? null;

  if (!user) {
    return {
      complete: false,
      hasMembership: false,
      policy,
      profile: null,
      questions: questions.map((question) => ({ ...question, answer: null })),
      tenantId: input.tenantId,
      tenantName: input.tenantName,
    };
  }

  const [memberships, answers, policyAccepted] = yield* Effect.all(
    [
      database
        .select({ id: usersToTenants.id })
        .from(usersToTenants)
        .where(
          and(
            eq(usersToTenants.tenantId, input.tenantId),
            eq(usersToTenants.userId, user.id),
          ),
        )
        .limit(1),
      latestAnswersByQuestion(
        database,
        input.tenantId,
        user.id,
        questions.map((question) => question.id),
      ),
      policy
        ? hasAcceptedPolicy(database, input.tenantId, user.id, policy.id)
        : Effect.succeed(false),
    ],
    { concurrency: 'unbounded' },
  );
  const hasMembership = memberships.length > 0;

  return {
    complete:
      hasMembership &&
      tenantOnboardingCompleteFromRecords({
        answeredQuestionIds: new Set(answers.keys()),
        currentPolicyExists: policy !== null,
        policyAccepted,
        questionIds: questions.map((question) => question.id),
      }),
    hasMembership,
    policy,
    profile: {
      communicationEmail: user.communicationEmail,
      firstName: user.firstName,
      lastName: user.lastName,
    },
    questions: questions.map((question) => ({
      ...question,
      answer: answers.get(question.id) ?? null,
    })),
    tenantId: input.tenantId,
    tenantName: input.tenantName,
  };
});

export const resolveCurrentTenantOnboardingSettings = Effect.fn(
  'resolveCurrentTenantOnboardingSettings',
)(function* (database: TenantOnboardingReadDatabase, tenantId: string) {
  const [policies, questions] = yield* Effect.all(
    [currentPolicy(database, tenantId), currentQuestions(database, tenantId)],
    { concurrency: 'unbounded' },
  );
  return {
    policy: policies[0] ?? null,
    questions: questions.map((question) => ({ ...question, answer: null })),
  };
});

const normalizeHttpUrl = (
  value: string,
): Effect.Effect<null | string, TenantOnboardingValidationError> => {
  const trimmed = value.trim();
  if (!trimmed) {
    return Effect.succeed(null);
  }

  return Effect.try({
    catch: () =>
      new TenantOnboardingValidationError({
        field: 'privacyPolicyUrl',
        message: 'Privacy policy URL must use http or https.',
      }),
    try: () => {
      const url = new URL(trimmed);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error('Unsupported protocol');
      }
      return url.toString();
    },
  });
};

export const normalizeTenantPrivacyPolicy = Effect.fn(
  'normalizeTenantPrivacyPolicy',
)(function* (input: { privacyPolicyText: string; privacyPolicyUrl: string }) {
  const privacyPolicyText = input.privacyPolicyText.trim() || null;
  const privacyPolicyUrl = yield* normalizeHttpUrl(input.privacyPolicyUrl);
  if (!privacyPolicyText && !privacyPolicyUrl) {
    return yield* Effect.fail(
      new TenantOnboardingConfigurationError({
        message:
          'Add privacy policy text or a privacy policy URL before publishing onboarding.',
      }),
    );
  }
  return { privacyPolicyText, privacyPolicyUrl };
});

export const normalizeTenantOnboardingQuestions = Effect.fn(
  'normalizeTenantOnboardingQuestions',
)(function* (
  questions: readonly {
    options: readonly string[];
    prompt: string;
    type: TenantOnboardingQuestionType;
  }[],
) {
  const normalized: NormalizedTenantOnboardingQuestion[] = [];
  for (const [index, question] of questions.entries()) {
    const prompt = question.prompt.trim();
    if (!prompt || prompt.length > 200) {
      return yield* Effect.fail(
        new TenantOnboardingValidationError({
          field: `questions.${index}.prompt`,
          message:
            'Question prompts must contain between 1 and 200 characters.',
        }),
      );
    }

    const options = [
      ...new Set(
        question.options
          .map((option) => option.trim())
          .filter((option) => option.length > 0),
      ),
    ];
    if (options.some((option) => option.length > 80)) {
      return yield* Effect.fail(
        new TenantOnboardingValidationError({
          field: `questions.${index}.options`,
          message: 'Selection options must be no longer than 80 characters.',
        }),
      );
    }
    if (question.type === 'shortText' && options.length > 0) {
      return yield* Effect.fail(
        new TenantOnboardingValidationError({
          field: `questions.${index}.options`,
          message: 'Short-text questions cannot contain selection options.',
        }),
      );
    }
    if (
      question.type === 'selection' &&
      (options.length < 2 || options.length > 20)
    ) {
      return yield* Effect.fail(
        new TenantOnboardingValidationError({
          field: `questions.${index}.options`,
          message: 'Selection questions require between 2 and 20 options.',
        }),
      );
    }

    normalized.push({ options, prompt, type: question.type });
  }
  return normalized;
});

export const onboardingQuestionsMatch = (
  stored: readonly NormalizedTenantOnboardingQuestion[],
  next: readonly NormalizedTenantOnboardingQuestion[],
): boolean =>
  stored.length === next.length &&
  stored.every(
    (question, index) =>
      question.prompt === next[index]?.prompt &&
      question.type === next[index]?.type &&
      question.options.length === next[index]?.options.length &&
      question.options.every(
        (option, optionIndex) => option === next[index]?.options[optionIndex],
      ),
  );

export const publishPrivacyPolicyVersionIfChanged = Effect.fn(
  'publishPrivacyPolicyVersionIfChanged',
)(function* (
  database: TenantOnboardingWriteDatabase,
  input: {
    actorUserId: null | string;
    policy: NormalizedTenantPrivacyPolicy;
    tenantId: string;
  },
) {
  const policies = yield* currentPolicy(database, input.tenantId);
  const previous = policies[0];
  if (
    previous?.privacyPolicyText === input.policy.privacyPolicyText &&
    previous.privacyPolicyUrl === input.policy.privacyPolicyUrl
  ) {
    return { changed: false, policy: previous };
  }

  const inserted = yield* database
    .insert(tenantPrivacyPolicyVersions)
    .values({
      createdByUserId: input.actorUserId,
      privacyPolicyText: input.policy.privacyPolicyText,
      privacyPolicyUrl: input.policy.privacyPolicyUrl,
      tenantId: input.tenantId,
      version: (previous?.version ?? 0) + 1,
    })
    .returning({
      id: tenantPrivacyPolicyVersions.id,
      privacyPolicyText: tenantPrivacyPolicyVersions.privacyPolicyText,
      privacyPolicyUrl: tenantPrivacyPolicyVersions.privacyPolicyUrl,
      version: tenantPrivacyPolicyVersions.version,
    });
  const policy = inserted[0];
  if (!policy) {
    return yield* Effect.die(
      new Error('Privacy policy version insert returned no row'),
    );
  }
  return { changed: true, policy };
});

export const countAffectedTenantUsers = Effect.fn('countAffectedTenantUsers')(
  function* (database: TenantOnboardingReadDatabase, tenantId: string) {
    const memberships = yield* database
      .select({ userId: usersToTenants.userId })
      .from(usersToTenants)
      .where(eq(usersToTenants.tenantId, tenantId));
    return new Set(memberships.map((membership) => membership.userId)).size;
  },
);

export const lockTenantForOnboardingSettings = Effect.fn(
  'lockTenantForOnboardingSettings',
)(function* (database: TenantOnboardingReadDatabase, tenantId: string) {
  const rows = yield* database
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .for('update');
  return rows.length > 0;
});
