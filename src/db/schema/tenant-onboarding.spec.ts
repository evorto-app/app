import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import {
  tenantOnboardingQuestionAnswers,
  tenantOnboardingQuestions,
  tenantPrivacyPolicyAcceptances,
  tenantPrivacyPolicyVersions,
  users,
} from '.';

describe('tenant onboarding schema', () => {
  it('keeps every privacy policy version uniquely addressable per tenant', () => {
    const config = getTableConfig(tenantPrivacyPolicyVersions);

    expect(config.checks.map((check) => check.name)).toContain(
      'tenant_privacy_policy_versions_has_content',
    );
    expect(config.indexes.map((index) => index.config.name)).toContain(
      'tenant_privacy_policy_versions_number_unique',
    );
  });

  it('enforces question type and option consistency in the database', () => {
    const config = getTableConfig(tenantOnboardingQuestions);

    expect(config.checks.map((check) => check.name)).toContain(
      'tenant_onboarding_questions_options_match_type',
    );
  });

  it('binds acceptances and answers to the same tenant as their requirement', () => {
    const acceptanceConfig = getTableConfig(tenantPrivacyPolicyAcceptances);
    const answerConfig = getTableConfig(tenantOnboardingQuestionAnswers);

    expect(
      acceptanceConfig.foreignKeys.map((foreignKey) => foreignKey.getName()),
    ).toContain('tenant_privacy_acceptance_policy_tenant_fk');
    expect(
      answerConfig.foreignKeys.map((foreignKey) => foreignKey.getName()),
    ).toContain('tenant_onboarding_answer_question_tenant_fk');
  });

  it('stores a nullable home-tenant reference on the global user', () => {
    const config = getTableConfig(users);

    expect(
      config.columns.find((column) => column.name === 'home_tenant_id'),
    ).toBeDefined();
  });
});
