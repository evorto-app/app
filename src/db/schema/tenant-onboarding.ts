import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';

import { createId } from '../create-id';
import { tenants } from './tenants';
import { users } from './users';

export const tenantOnboardingQuestionTypes = pgEnum(
  'tenant_onboarding_question_type',
  ['shortText', 'selection'],
);

export const tenantPrivacyPolicyVersions = pgTable(
  'tenant_privacy_policy_versions',
  {
    createdAt: timestamp().notNull().defaultNow(),
    createdByUserId: varchar({ length: 20 }).references(() => users.id),
    id: varchar({ length: 20 })
      .$defaultFn(() => createId())
      .primaryKey(),
    privacyPolicyText: text('privacy_policy_text'),
    privacyPolicyUrl: text('privacy_policy_url'),
    tenantId: varchar({ length: 20 })
      .notNull()
      .references(() => tenants.id),
    version: integer().notNull(),
  },
  (table) => [
    check(
      'tenant_privacy_policy_versions_has_content',
      sql`${table.privacyPolicyText} is not null or ${table.privacyPolicyUrl} is not null`,
    ),
    index('tenant_privacy_policy_versions_tenant_idx').on(table.tenantId),
    unique('tenant_privacy_policy_versions_id_tenant_unique').on(
      table.id,
      table.tenantId,
    ),
    uniqueIndex('tenant_privacy_policy_versions_number_unique').on(
      table.tenantId,
      table.version,
    ),
  ],
);

export const tenantOnboardingQuestions = pgTable(
  'tenant_onboarding_questions',
  {
    createdAt: timestamp().notNull().defaultNow(),
    createdByUserId: varchar({ length: 20 }).references(() => users.id),
    id: varchar({ length: 20 })
      .$defaultFn(() => createId())
      .primaryKey(),
    options: jsonb().$type<string[]>().notNull().default([]),
    prompt: text().notNull(),
    retiredAt: timestamp(),
    sortOrder: integer().notNull().default(0),
    tenantId: varchar({ length: 20 })
      .notNull()
      .references(() => tenants.id),
    type: tenantOnboardingQuestionTypes().notNull(),
  },
  (table) => [
    check(
      'tenant_onboarding_questions_options_match_type',
      sql`(${table.type} = 'shortText' and jsonb_array_length(${table.options}) = 0)
        or (${table.type} = 'selection' and jsonb_array_length(${table.options}) >= 2)`,
    ),
    index('tenant_onboarding_questions_current_idx').on(
      table.tenantId,
      table.retiredAt,
      table.sortOrder,
    ),
    unique('tenant_onboarding_questions_id_tenant_unique').on(
      table.id,
      table.tenantId,
    ),
  ],
);

export const tenantPrivacyPolicyAcceptances = pgTable(
  'tenant_privacy_policy_acceptances',
  {
    acceptedAt: timestamp().notNull().defaultNow(),
    id: varchar({ length: 20 })
      .$defaultFn(() => createId())
      .primaryKey(),
    policyVersionId: varchar({ length: 20 }).notNull(),
    tenantId: varchar({ length: 20 })
      .notNull()
      .references(() => tenants.id),
    userId: varchar({ length: 20 })
      .notNull()
      .references(() => users.id),
  },
  (table) => [
    foreignKey({
      columns: [table.policyVersionId, table.tenantId],
      foreignColumns: [
        tenantPrivacyPolicyVersions.id,
        tenantPrivacyPolicyVersions.tenantId,
      ],
      name: 'tenant_privacy_acceptance_policy_tenant_fk',
    }),
    index('tenant_privacy_acceptances_tenant_user_idx').on(
      table.tenantId,
      table.userId,
    ),
    uniqueIndex('tenant_privacy_acceptances_user_version_unique').on(
      table.userId,
      table.policyVersionId,
    ),
  ],
);

export const tenantOnboardingQuestionAnswers = pgTable(
  'tenant_onboarding_question_answers',
  {
    answer: text().notNull(),
    answeredAt: timestamp().notNull().defaultNow(),
    id: varchar({ length: 20 })
      .$defaultFn(() => createId())
      .primaryKey(),
    questionId: varchar({ length: 20 }).notNull(),
    tenantId: varchar({ length: 20 })
      .notNull()
      .references(() => tenants.id),
    userId: varchar({ length: 20 })
      .notNull()
      .references(() => users.id),
  },
  (table) => [
    foreignKey({
      columns: [table.questionId, table.tenantId],
      foreignColumns: [
        tenantOnboardingQuestions.id,
        tenantOnboardingQuestions.tenantId,
      ],
      name: 'tenant_onboarding_answer_question_tenant_fk',
    }),
    index('tenant_onboarding_answers_current_lookup_idx').on(
      table.tenantId,
      table.userId,
      table.questionId,
      table.answeredAt,
    ),
  ],
);
