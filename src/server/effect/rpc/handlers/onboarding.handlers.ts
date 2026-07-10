import { RpcUnauthorizedError } from '@shared/errors/rpc-errors';
import { notificationEmailPattern } from '@shared/notification-email';
import {
  TenantOnboardingConfigurationError,
  TenantOnboardingRequirementsChangedError,
  TenantOnboardingValidationError,
} from '@shared/rpc-contracts/app-rpcs/onboarding.errors';
import {
  TenantOnboardingProfileRecord,
  TenantOnboardingQuestionRecord,
  TenantOnboardingRequirementsRecord,
  TenantPrivacyPolicyVersionRecord,
} from '@shared/rpc-contracts/app-rpcs/onboarding.rpcs';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { Effect } from 'effect';

import type { AppRpcHandlers } from './shared/handler-types';

import { Database } from '../../../../db';
import {
  roles,
  rolesToTenantUsers,
  tenantOnboardingQuestionAnswers,
  tenantOnboardingQuestions,
  tenantPrivacyPolicyAcceptances,
  tenantPrivacyPolicyVersions,
  tenants,
  users,
  usersToTenants,
} from '../../../../db/schema';
import {
  countAffectedTenantUsers,
  lockTenantForOnboardingSettings,
  normalizeTenantOnboardingQuestions,
  normalizeTenantPrivacyPolicy,
  onboardingQuestionsMatch,
  publishPrivacyPolicyVersionIfChanged,
  resolveCurrentTenantOnboardingSettings,
  resolveTenantOnboardingRequirements,
} from '../../../onboarding/tenant-onboarding.service';
import { RpcAccess } from './shared/rpc-access.service';

const authDataString = (
  authData: Record<string, unknown>,
  field: string,
): string | undefined => {
  const value = authData[field];
  return typeof value === 'string' ? value.trim() || undefined : undefined;
};

const failValidation = (field: string, message: string) =>
  Effect.fail(new TenantOnboardingValidationError({ field, message }));

export const verifiedOnboardingIdentity = (
  authData: Record<string, unknown>,
): undefined | { auth0Id: string; email: string } => {
  const auth0Id = authDataString(authData, 'sub');
  const email = authDataString(authData, 'email');
  return auth0Id && email && authData['email_verified'] === true
    ? { auth0Id, email }
    : undefined;
};

export const normalizeOnboardingProfile = (input: {
  communicationEmail: string;
  firstName: string;
  lastName: string;
}) => {
  const communicationEmail = input.communicationEmail.trim();
  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();

  if (!firstName || firstName.length > 100) {
    return failValidation(
      'firstName',
      'First name must contain between 1 and 100 characters.',
    );
  }
  if (!lastName || lastName.length > 100) {
    return failValidation(
      'lastName',
      'Last name must contain between 1 and 100 characters.',
    );
  }
  if (!notificationEmailPattern.test(communicationEmail)) {
    return failValidation(
      'communicationEmail',
      'Enter a valid notification email address.',
    );
  }

  return Effect.succeed({ communicationEmail, firstName, lastName });
};

export const validateOnboardingAnswers = (
  answers: readonly { questionId: string; value: string }[],
  questions: readonly {
    id: string;
    options: readonly string[];
    prompt: string;
    type: 'selection' | 'shortText';
  }[],
) =>
  Effect.gen(function* () {
    const answerMap = new Map<string, string>();
    for (const answer of answers) {
      if (answerMap.has(answer.questionId)) {
        return yield* failValidation(
          `answers.${answer.questionId}`,
          'Submit one answer per onboarding question.',
        );
      }
      answerMap.set(answer.questionId, answer.value.trim());
    }

    const questionIds = new Set(questions.map((question) => question.id));
    const unexpectedQuestionId = answers.find(
      (answer) => !questionIds.has(answer.questionId),
    )?.questionId;
    if (unexpectedQuestionId) {
      return yield* new TenantOnboardingRequirementsChangedError({
        message:
          'Onboarding questions changed while you were completing the form. Review the current questions and submit again.',
      });
    }

    const validated: { answer: string; questionId: string }[] = [];
    for (const question of questions) {
      const answer = answerMap.get(question.id) ?? '';
      if (!answer) {
        return yield* failValidation(
          `answers.${question.id}`,
          `Answer “${question.prompt}” before continuing.`,
        );
      }
      if (question.type === 'shortText' && answer.length > 250) {
        return yield* failValidation(
          `answers.${question.id}`,
          'Short-text answers must be no longer than 250 characters.',
        );
      }
      if (question.type === 'selection' && !question.options.includes(answer)) {
        return yield* failValidation(
          `answers.${question.id}`,
          'Choose one of the available options.',
        );
      }
      validated.push({ answer, questionId: question.id });
    }
    return validated;
  });

const expectedOnboardingError = (
  error: unknown,
): error is
  | TenantOnboardingConfigurationError
  | TenantOnboardingRequirementsChangedError
  | TenantOnboardingValidationError =>
  error instanceof TenantOnboardingConfigurationError ||
  error instanceof TenantOnboardingRequirementsChangedError ||
  error instanceof TenantOnboardingValidationError;

export const onboardingHandlers = {
  'onboarding.adminSettings': () =>
    Effect.gen(function* () {
      yield* RpcAccess.ensurePermission('admin:changeSettings');
      const context = yield* RpcAccess.current();
      const settings = yield* Database.use((database) =>
        resolveCurrentTenantOnboardingSettings(
          database,
          context.tenant.id,
        ).pipe(Effect.orDie),
      );
      return {
        policy: settings.policy
          ? TenantPrivacyPolicyVersionRecord.make(settings.policy)
          : null,
        questions: settings.questions.map((question) =>
          TenantOnboardingQuestionRecord.make(question),
        ),
      };
    }),

  'onboarding.complete': (input) =>
    Effect.gen(function* () {
      yield* RpcAccess.ensureAuthenticated();
      const context = yield* RpcAccess.current();
      const identity = verifiedOnboardingIdentity(context.authData);
      if (!identity) {
        return yield* failValidation(
          'authentication',
          'Your authenticated account must have a stable identifier and a verified email address.',
        );
      }
      const profile = yield* normalizeOnboardingProfile(input);
      if (!input.acceptedPrivacyPolicy) {
        return yield* failValidation(
          'acceptedPrivacyPolicy',
          'Accept the current privacy policy before continuing.',
        );
      }

      yield* Database.use((database) =>
        database
          .transaction((tx) =>
            Effect.gen(function* () {
              const tenantExists = yield* lockTenantForOnboardingSettings(
                tx,
                context.tenant.id,
              );
              if (!tenantExists) {
                return yield* Effect.die(new Error('Tenant not found'));
              }

              const currentPolicies = yield* tx
                .select({
                  id: tenantPrivacyPolicyVersions.id,
                })
                .from(tenantPrivacyPolicyVersions)
                .where(
                  eq(tenantPrivacyPolicyVersions.tenantId, context.tenant.id),
                )
                .orderBy(desc(tenantPrivacyPolicyVersions.version))
                .limit(1);
              const currentPolicy = currentPolicies[0];
              if (!currentPolicy) {
                return yield* new TenantOnboardingConfigurationError({
                  message:
                    'This tenant has not published a privacy policy yet. Contact a tenant administrator.',
                });
              }
              if (currentPolicy.id !== input.policyVersionId) {
                return yield* new TenantOnboardingRequirementsChangedError({
                  message:
                    'The privacy policy changed while you were completing the form. Review the current version and submit again.',
                });
              }

              const questions = yield* tx
                .select({
                  id: tenantOnboardingQuestions.id,
                  options: tenantOnboardingQuestions.options,
                  prompt: tenantOnboardingQuestions.prompt,
                  type: tenantOnboardingQuestions.type,
                })
                .from(tenantOnboardingQuestions)
                .where(
                  and(
                    eq(tenantOnboardingQuestions.tenantId, context.tenant.id),
                    isNull(tenantOnboardingQuestions.retiredAt),
                  ),
                )
                .orderBy(
                  tenantOnboardingQuestions.sortOrder,
                  tenantOnboardingQuestions.createdAt,
                );
              const answers = yield* validateOnboardingAnswers(
                input.answers,
                questions,
              );

              const existingUsers = yield* tx
                .select({ id: users.id })
                .from(users)
                .where(eq(users.auth0Id, identity.auth0Id))
                .for('update');
              let userId = existingUsers[0]?.id;
              if (userId) {
                yield* tx
                  .update(users)
                  .set(profile)
                  .where(eq(users.id, userId));
              } else {
                const insertedUsers = yield* tx
                  .insert(users)
                  .values({
                    auth0Id: identity.auth0Id,
                    communicationEmail: profile.communicationEmail,
                    email: identity.email,
                    firstName: profile.firstName,
                    lastName: profile.lastName,
                  })
                  .onConflictDoNothing({ target: users.auth0Id })
                  .returning({ id: users.id });
                userId = insertedUsers[0]?.id;
                if (!userId) {
                  const concurrentUsers = yield* tx
                    .select({ id: users.id })
                    .from(users)
                    .where(eq(users.auth0Id, identity.auth0Id))
                    .for('update');
                  userId = concurrentUsers[0]?.id;
                }
              }
              if (!userId) {
                return yield* Effect.die(
                  new Error('Unable to resolve user during onboarding'),
                );
              }

              yield* tx
                .insert(tenantPrivacyPolicyAcceptances)
                .values({
                  policyVersionId: currentPolicy.id,
                  tenantId: context.tenant.id,
                  userId,
                })
                .onConflictDoNothing({
                  target: [
                    tenantPrivacyPolicyAcceptances.userId,
                    tenantPrivacyPolicyAcceptances.policyVersionId,
                  ],
                });

              const previousAnswerRows =
                answers.length === 0
                  ? []
                  : yield* tx
                      .select({
                        answer: tenantOnboardingQuestionAnswers.answer,
                        questionId: tenantOnboardingQuestionAnswers.questionId,
                      })
                      .from(tenantOnboardingQuestionAnswers)
                      .where(
                        and(
                          eq(
                            tenantOnboardingQuestionAnswers.tenantId,
                            context.tenant.id,
                          ),
                          eq(tenantOnboardingQuestionAnswers.userId, userId),
                        ),
                      )
                      .orderBy(
                        desc(tenantOnboardingQuestionAnswers.answeredAt),
                      );
              const latestAnswer = new Map<string, string>();
              for (const answer of previousAnswerRows) {
                if (!latestAnswer.has(answer.questionId)) {
                  latestAnswer.set(answer.questionId, answer.answer);
                }
              }
              const changedAnswers = answers.filter(
                (answer) =>
                  latestAnswer.get(answer.questionId) !== answer.answer,
              );
              if (changedAnswers.length > 0) {
                yield* tx.insert(tenantOnboardingQuestionAnswers).values(
                  changedAnswers.map((answer) => ({
                    answer: answer.answer,
                    questionId: answer.questionId,
                    tenantId: context.tenant.id,
                    userId,
                  })),
                );
              }

              const memberships = yield* tx
                .select({ id: usersToTenants.id })
                .from(usersToTenants)
                .where(
                  and(
                    eq(usersToTenants.tenantId, context.tenant.id),
                    eq(usersToTenants.userId, userId),
                  ),
                )
                .limit(1);
              let membershipId = memberships[0]?.id;
              if (!membershipId) {
                const insertedMemberships = yield* tx
                  .insert(usersToTenants)
                  .values({ tenantId: context.tenant.id, userId })
                  .onConflictDoNothing({
                    target: [usersToTenants.userId, usersToTenants.tenantId],
                  })
                  .returning({ id: usersToTenants.id });
                membershipId = insertedMemberships[0]?.id;
              }
              if (!membershipId) {
                const concurrentMemberships = yield* tx
                  .select({ id: usersToTenants.id })
                  .from(usersToTenants)
                  .where(
                    and(
                      eq(usersToTenants.tenantId, context.tenant.id),
                      eq(usersToTenants.userId, userId),
                    ),
                  )
                  .limit(1);
                membershipId = concurrentMemberships[0]?.id;
              }
              if (!membershipId) {
                return yield* Effect.die(
                  new Error('Unable to create tenant membership'),
                );
              }

              const existingRoleAssignments = yield* tx
                .select({ roleId: rolesToTenantUsers.roleId })
                .from(rolesToTenantUsers)
                .where(eq(rolesToTenantUsers.userTenantId, membershipId))
                .limit(1);
              if (existingRoleAssignments.length === 0) {
                const defaultRoles = yield* tx
                  .select({ id: roles.id })
                  .from(roles)
                  .where(
                    and(
                      eq(roles.tenantId, context.tenant.id),
                      eq(roles.defaultUserRole, true),
                    ),
                  );
                if (defaultRoles.length > 0) {
                  yield* tx
                    .insert(rolesToTenantUsers)
                    .values(
                      defaultRoles.map((role) => ({
                        roleId: role.id,
                        tenantId: context.tenant.id,
                        userTenantId: membershipId,
                      })),
                    )
                    .onConflictDoNothing();
                }
              }

              yield* tx
                .update(users)
                .set({ homeTenantId: context.tenant.id })
                .where(and(eq(users.id, userId), isNull(users.homeTenantId)));
            }),
          )
          .pipe(
            Effect.catch((error) =>
              expectedOnboardingError(error)
                ? Effect.fail(error)
                : Effect.die(error),
            ),
          ),
      );
    }),

  'onboarding.publishSettings': (input) =>
    Effect.gen(function* () {
      yield* RpcAccess.ensurePermission('admin:changeSettings');
      const context = yield* RpcAccess.current();
      const user = yield* RpcAccess.requireUser();
      const policy = yield* normalizeTenantPrivacyPolicy(input);
      const questions = yield* normalizeTenantOnboardingQuestions(
        input.questions,
      );

      return yield* Database.use((database) =>
        database
          .transaction((tx) =>
            Effect.gen(function* () {
              const tenantExists = yield* lockTenantForOnboardingSettings(
                tx,
                context.tenant.id,
              );
              if (!tenantExists) {
                return yield* Effect.die(new Error('Tenant not found'));
              }

              const previousSettings =
                yield* resolveCurrentTenantOnboardingSettings(
                  tx,
                  context.tenant.id,
                );
              const policyResult = yield* publishPrivacyPolicyVersionIfChanged(
                tx,
                {
                  actorUserId: user.id,
                  policy,
                  tenantId: context.tenant.id,
                },
              );
              const storedQuestions = previousSettings.questions.map(
                (question) => ({
                  options: [...question.options],
                  prompt: question.prompt,
                  type: question.type,
                }),
              );
              const questionsChanged = !onboardingQuestionsMatch(
                storedQuestions,
                questions,
              );

              if (questionsChanged) {
                yield* tx
                  .update(tenantOnboardingQuestions)
                  .set({ retiredAt: sql`CURRENT_TIMESTAMP` })
                  .where(
                    and(
                      eq(tenantOnboardingQuestions.tenantId, context.tenant.id),
                      isNull(tenantOnboardingQuestions.retiredAt),
                    ),
                  );
                if (questions.length > 0) {
                  yield* tx.insert(tenantOnboardingQuestions).values(
                    questions.map((question, sortOrder) => ({
                      ...question,
                      createdByUserId: user.id,
                      sortOrder,
                      tenantId: context.tenant.id,
                    })),
                  );
                }
              }

              yield* tx
                .update(tenants)
                .set(policy)
                .where(eq(tenants.id, context.tenant.id));
              const affectedUsers = policyResult.changed
                ? yield* countAffectedTenantUsers(tx, context.tenant.id)
                : 0;

              return {
                affectedUsers,
                policyChanged: policyResult.changed,
                policyVersion: policyResult.policy.version,
                questionsChanged,
              };
            }),
          )
          .pipe(
            Effect.catch((error) =>
              expectedOnboardingError(error)
                ? Effect.fail(error)
                : Effect.die(error),
            ),
          ),
      );
    }),

  'onboarding.requirements': () =>
    Effect.gen(function* () {
      yield* RpcAccess.ensureAuthenticated();
      const context = yield* RpcAccess.current();
      const auth0Id = authDataString(context.authData, 'sub');
      if (!auth0Id) {
        return yield* new RpcUnauthorizedError({
          message:
            'Your authenticated account is missing a stable identifier. Log out and sign in again.',
        });
      }
      const requirements = yield* Database.use((database) =>
        resolveTenantOnboardingRequirements(database, {
          auth0Id,
          tenantId: context.tenant.id,
          tenantName: context.tenant.name,
        }).pipe(Effect.orDie),
      );
      return TenantOnboardingRequirementsRecord.make({
        ...requirements,
        policy: requirements.policy
          ? TenantPrivacyPolicyVersionRecord.make(requirements.policy)
          : null,
        profile: requirements.profile
          ? TenantOnboardingProfileRecord.make(requirements.profile)
          : null,
        questions: requirements.questions.map((question) =>
          TenantOnboardingQuestionRecord.make(question),
        ),
      });
    }),

  'onboarding.status': () =>
    Effect.gen(function* () {
      yield* RpcAccess.ensureAuthenticated();
      const context = yield* RpcAccess.current();
      const auth0Id = authDataString(context.authData, 'sub');
      if (!auth0Id) {
        return { complete: false };
      }
      const requirements = yield* Database.use((database) =>
        resolveTenantOnboardingRequirements(database, {
          auth0Id,
          tenantId: context.tenant.id,
          tenantName: context.tenant.name,
        }).pipe(Effect.orDie),
      );
      return { complete: requirements.complete };
    }),
} satisfies Partial<AppRpcHandlers>;
