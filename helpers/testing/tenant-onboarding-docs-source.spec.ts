import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { documentationConsumerGuideCatalog } from './documentation-publication-contract';

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));

const readSource = (sourcePath: string): string =>
  readFileSync(path.join(repositoryRoot, sourcePath), 'utf8');

describe('member-onboarding generated documentation source', () => {
  it('promotes the cross-organization home-selection journey without a parallel duplicate', () => {
    const source = readSource('tests/docs/users/tenant-onboarding.doc.ts');
    const functionalSource = readSource(
      'tests/specs/profile/tenant-onboarding.spec.ts',
    );
    const firstStepsGuide = documentationConsumerGuideCatalog.find(
      (guide) => guide.slug === 'first-steps',
    );

    expect(source).toContain(
      "test('Join another organization and choose your home organization'",
    );
    expect(source).toContain('storageState: userStateFile');
    expect(source).toContain("member.page.goto('/events')");
    expect(source).toContain("name: 'Join organization'");
    expect(source).toContain("name: 'You are browsing another organization'");
    expect(source).toContain("name: 'Make this my home organization'");
    expect(source).toContain('await makeHomeTenantButton.click()');
    expect(source).toContain('database.query.usersToTenants.findFirst');
    expect(source).toContain(
      'database.query.tenantPrivacyPolicyAcceptances.findFirst',
    );
    expect(source).toContain(
      'database.query.tenantOnboardingQuestionAnswers.findMany',
    );
    expect(source).toContain(
      'expect(userAfterJoin?.homeTenantId).toBe(originalUser.homeTenantId)',
    );
    expect(source).toContain('.toBe(joinedTenantId)');
    expect(source).toContain(
      '.set({ homeTenantId: originalUser.homeTenantId })',
    );
    expect(source).toContain('.delete(schema.tenantPrivacyPolicyAcceptances)');
    expect(source).toContain('member.page.reload()');
    expect(source).toContain(
      '# Join Another Organization and Choose Your Home Organization',
    );
    expect(firstStepsGuide?.sourceSlugs).toContain(
      'join-another-organization-and-choose-your-home-organization',
    );
    expect(functionalSource).not.toContain(
      'collects current requirements before a cross-tenant join',
    );
  });
});
