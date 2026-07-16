import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { requiredByTarget } from './runtime-preflight';

const readSource = (sourcePath: string): string =>
  fs.readFileSync(path.join(process.cwd(), sourcePath), 'utf8');

const requiredCertificationSecrets = [
  'AUTH0_MANAGEMENT_CLIENT_ID',
  'AUTH0_MANAGEMENT_CLIENT_SECRET',
  'CLIENT_ID',
  'CLIENT_SECRET',
  'E2E_ADMIN_USER_PASSWORD',
  'E2E_DEFAULT_USER_PASSWORD',
  'E2E_EMPTY_USER_PASSWORD',
  'E2E_GLOBAL_ADMIN_USER_PASSWORD',
  'E2E_ORGANIZER_USER_PASSWORD',
  'E2E_REGULAR_USER_PASSWORD',
  'E2E_LIVE_ESN_CARD_EXPIRED_IDENTIFIER',
  'E2E_LIVE_ESN_CARD_IDENTIFIER',
  'FONT_AWESOME_TOKEN',
  'NEON_API_KEY',
  'PARENT_BRANCH_ID',
  'PUBLIC_GOOGLE_MAPS_API_KEY',
  'SECRET',
  'STRIPE_TEST_API_KEY',
] as const;

const expectImmutableActionReferences = (workflow: string) => {
  const actionReferences = Array.from(
    workflow.matchAll(/uses:\s+[^@\s]+@([^\s#]+)/gu),
    (match) => match[1],
  );

  expect(actionReferences.length).toBeGreaterThan(0);
  expect(actionReferences).toEqual(
    actionReferences.map(() => expect.stringMatching(/^[a-f0-9]{40}$/u)),
  );
};

const expectExplicitSecretMappings = (workflow: string) => {
  expect(workflow).not.toContain('secrets: inherit');
  for (const secretName of requiredCertificationSecrets) {
    expect(workflow).toContain(`${secretName}: \${{ secrets.${secretName} }}`);
  }
};

const expectRuntimeVariablesAvailable = (environmentSource: string) => {
  for (const { name } of requiredByTarget.playwright) {
    expect(environmentSource).toMatch(new RegExp(`^\\s+${name}:`, 'mu'));
  }
};

describe('production provider certification source', () => {
  it('keeps every baseline Auth0 test-account password in an explicit secret boundary', () => {
    const baselineWorkflow = readSource('.github/workflows/e2e-baseline.yml');
    const triggerBlock = baselineWorkflow.slice(
      baselineWorkflow.indexOf('on:'),
      baselineWorkflow.indexOf('concurrency:'),
    );
    const protectedRefJob = baselineWorkflow.slice(
      baselineWorkflow.indexOf('  validate-protected-ref:'),
      baselineWorkflow.indexOf('  e2e:'),
    );
    const baselineJobStart = baselineWorkflow.indexOf('  e2e:');
    const validationStep = baselineWorkflow.slice(
      baselineWorkflow.indexOf('- name: Validate required configuration'),
      baselineWorkflow.indexOf('- name: Checkout repository'),
    );
    const playwrightStep = baselineWorkflow.slice(
      baselineWorkflow.indexOf('- name: Run Playwright suites'),
      baselineWorkflow.indexOf('- name: Collect Docker logs'),
    );
    const baselineJobEnvironment = baselineWorkflow.slice(
      baselineWorkflow.indexOf('    env:', baselineJobStart),
      baselineWorkflow.indexOf('    steps:', baselineJobStart),
    );
    const validationVariables = validationStep
      .split('\n')
      .find((line) => line.includes('for variable_name in'));

    expect(baselineWorkflow).not.toContain('secrets: inherit');
    expect(triggerBlock).toContain('push:\n    branches: [main]');
    expect(triggerBlock).toContain('workflow_dispatch:');
    expect(triggerBlock).not.toContain('pull_request:');
    expect(triggerBlock).not.toContain('develop');
    expect(protectedRefJob).toContain(
      'name: Require protected main E2E source',
    );
    expect(protectedRefJob).toContain('E2E_REF: ${{ github.ref }}');
    expect(protectedRefJob).toContain(
      'E2E_REF_PROTECTED: ${{ github.ref_protected }}',
    );
    expect(protectedRefJob).toContain(
      'if [ "${E2E_REF}" != "refs/heads/main" ]; then',
    );
    expect(protectedRefJob).toContain(
      'if [ "${E2E_REF_PROTECTED}" != "true" ]; then',
    );
    expect(protectedRefJob).not.toContain('${{ secrets.');
    expect(baselineWorkflow).toContain('needs: validate-protected-ref');
    expect(baselineWorkflow).toContain(
      'environment: esncard-release-certification',
    );
    expect(baselineWorkflow).toContain('persist-credentials: false');
    expect(baselineWorkflow).toContain('ref: ${{ github.sha }}');
    for (const secretName of requiredCertificationSecrets.filter((name) =>
      name.endsWith('_USER_PASSWORD'),
    )) {
      const mapping = `${secretName}: \${{ secrets.${secretName} }}`;
      expect(validationStep).toContain(mapping);
      expect(validationVariables).toContain(secretName);
      expect(playwrightStep).toContain(
        `${secretName}: \${{ secrets.${secretName} }}`,
      );
    }
    for (const secretName of ['FONT_AWESOME_TOKEN', 'NEON_API_KEY']) {
      expect(playwrightStep).toContain(
        `${secretName}: \${{ secrets.${secretName} }}`,
      );
    }
    expectRuntimeVariablesAvailable(
      `${baselineJobEnvironment}\n${playwrightStep}`,
    );
  });

  it('keeps Stripe test credentials out of production-key mappings', () => {
    const baselineWorkflow = readSource('.github/workflows/e2e-baseline.yml');

    expect(baselineWorkflow).toContain('      STRIPE_TEST_API_KEY:');
    expect(baselineWorkflow).toContain(
      'STRIPE_TEST_API_KEY must be a Stripe test-mode secret key',
    );
    expect(baselineWorkflow).toContain(
      'STRIPE_API_KEY: ${{ secrets.STRIPE_TEST_API_KEY }}',
    );
    expect(baselineWorkflow).not.toContain(
      'STRIPE_API_KEY: ${{ secrets.STRIPE_API_KEY }}',
    );
  });

  it('keeps the manual and reusable certification workflow fail-closed', () => {
    const workflow = readSource(
      '.github/workflows/esncard-release-certification.yml',
    );
    const workflowCallBlock = workflow.slice(
      workflow.indexOf('  workflow_call:'),
      workflow.indexOf('  workflow_dispatch:'),
    );
    const protectedRefJob = workflow.slice(
      workflow.indexOf('  validate-protected-ref:'),
      workflow.indexOf('  certify:'),
    );
    const certifyJobStart = workflow.indexOf('  certify:');
    const jobEnvironmentBlock = workflow.slice(
      workflow.indexOf('    env:', certifyJobStart),
      workflow.indexOf('    steps:', certifyJobStart),
    );
    const validationStep = workflow.indexOf(
      '- name: Validate required provider certification configuration',
    );
    const firstActionStep = workflow.indexOf('uses:');
    const validationStepSource = workflow.slice(
      validationStep,
      workflow.indexOf('- name: Checkout repository'),
    );
    const preflightStepSource = workflow.slice(
      workflow.indexOf('- name: Run fail-closed release preflight'),
      workflow.indexOf('- name: Install Playwright browsers'),
    );
    const integrationStepSource = workflow.slice(
      workflow.indexOf(
        '- name: Run credential-backed Auth0 and Google Maps integration certification',
      ),
      workflow.indexOf(
        '- name: Run provider-error UI and live ESNcard certification',
      ),
    );
    const liveStepSource = workflow.slice(
      workflow.indexOf(
        '- name: Run provider-error UI and live ESNcard certification',
      ),
      workflow.indexOf('- name: Stop Docker stack'),
    );

    expect(workflow).toContain('name: Production Provider Certification');
    expect(workflow).toContain('workflow_call:');
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('environment: esncard-release-certification');
    expect(protectedRefJob).toContain(
      'name: Require protected main certification source',
    );
    expect(protectedRefJob).toContain('CERTIFICATION_REF: ${{ github.ref }}');
    expect(protectedRefJob).toContain(
      'CERTIFICATION_REF_PROTECTED: ${{ github.ref_protected }}',
    );
    expect(protectedRefJob).toContain(
      'if [ "${CERTIFICATION_REF}" != "refs/heads/main" ]; then',
    );
    expect(protectedRefJob).toContain(
      'if [ "${CERTIFICATION_REF_PROTECTED}" != "true" ]; then',
    );
    expect(protectedRefJob).not.toContain('${{ secrets.');
    expect(workflow).toContain('needs: validate-protected-ref');
    expect(workflow).toContain('persist-credentials: false');
    expect(workflow).toContain('ref: ${{ github.sha }}');
    expect(workflow).toContain('group: provider-certification');
    expect(workflow).not.toContain('provider-certification-${{ github.ref }}');
    expect(workflow).toContain('permissions:\n  contents: read');
    for (const secretName of requiredCertificationSecrets) {
      expect(workflowCallBlock).toMatch(
        new RegExp(
          String.raw`${secretName}:\n\s+description:.*\n\s+required: true`,
          'u',
        ),
      );
    }
    expect(validationStep).toBeGreaterThan(-1);
    expect(validationStep).toBeLessThan(firstActionStep);
    expect(jobEnvironmentBlock).not.toContain('${{ secrets.');
    expect(workflow).toContain(
      'Missing required provider certification configuration: ${variable_name}',
    );
    expect(workflow).toContain(
      'STRIPE_TEST_API_KEY must be a Stripe test-mode secret key',
    );
    expect(workflow).toContain(
      'bun helpers/testing/runtime-preflight.ts esncard-release',
    );
    expect(workflow).toContain('bun run test:e2e:live-esncard:release');
    expect(workflow).toContain(
      'E2E_SELECTED_PROJECTS: local-chrome-live-esncard,docs-live-esncard',
    );
    expect(workflow).toContain(
      'AUTH0_MANAGEMENT_CLIENT_ID: ${{ secrets.AUTH0_MANAGEMENT_CLIENT_ID }}',
    );
    expect(workflow).toContain(
      'AUTH0_MANAGEMENT_CLIENT_SECRET: ${{ secrets.AUTH0_MANAGEMENT_CLIENT_SECRET }}',
    );
    expect(workflow).toContain(
      'PUBLIC_GOOGLE_MAPS_API_KEY: ${{ secrets.PUBLIC_GOOGLE_MAPS_API_KEY }}',
    );
    expect(workflow).toContain(
      'E2E_SELECTED_PROJECTS: local-chrome-integration,docs-integration',
    );
    expect(workflow).toContain('bun run test:e2e:integration');
    expect(workflow).toContain(
      'STRIPE_API_KEY: ${{ secrets.STRIPE_TEST_API_KEY }}',
    );
    expect(workflow).not.toContain(
      'STRIPE_API_KEY: ${{ secrets.STRIPE_API_KEY }}',
    );
    expectImmutableActionReferences(workflow);
    expect(workflow).toContain(
      'oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2.2.0',
    );
    expect(workflow).not.toContain('actions/upload-artifact');
    expect(workflow).not.toMatch(
      /echo[^\n]*\$\{E2E_LIVE_ESN_CARD_IDENTIFIER\}/u,
    );
    expect(workflow).not.toMatch(
      /echo[^\n]*\$\{E2E_LIVE_ESN_CARD_EXPIRED_IDENTIFIER\}/u,
    );
    for (const secretName of requiredCertificationSecrets.filter((name) =>
      name.endsWith('_USER_PASSWORD'),
    )) {
      const mapping = `${secretName}: \${{ secrets.${secretName} }}`;
      expect(validationStepSource).toContain(mapping);
      expect(
        validationStepSource
          .split('\n')
          .find((line) => line.includes('for variable_name in')),
      ).toContain(secretName);
      expect(preflightStepSource).toContain(mapping);
      expect(integrationStepSource).toContain(mapping);
      expect(liveStepSource).toContain(mapping);
    }
    for (const secretName of ['FONT_AWESOME_TOKEN', 'NEON_API_KEY']) {
      expect(integrationStepSource).toContain(
        `${secretName}: \${{ secrets.${secretName} }}`,
      );
    }
    expectRuntimeVariablesAvailable(
      `${jobEnvironmentBlock}\n${integrationStepSource}`,
    );
  });

  it('blocks the repository release job on complete provider certification', () => {
    const releaseWorkflow = readSource('.github/workflows/release.yml');

    expect(releaseWorkflow).toContain('provider-certification:');
    expect(releaseWorkflow).toContain(
      'name: Required production provider certification',
    );
    expect(releaseWorkflow).toContain(
      'uses: ./.github/workflows/esncard-release-certification.yml',
    );
    expect(releaseWorkflow).toContain('needs: provider-certification');
    expect(releaseWorkflow).toContain('permissions:\n  contents: read');
    expectExplicitSecretMappings(releaseWorkflow);
    expectImmutableActionReferences(releaseWorkflow);
  });

  it('runs only the active-and-expired live-provider project plus existing provider-error UI coverage', () => {
    const packageJson = JSON.parse(readSource('package.json')) as {
      scripts: Record<string, string>;
    };
    const playwrightConfig = readSource('playwright.config.ts');
    const runtimeConfig = readSource(
      'src/server/config/test-runtime-config.ts',
    );
    const releaseScript =
      packageJson.scripts['test:e2e:live-esncard:release'] ?? '';
    const providerErrorUiScript =
      packageJson.scripts['test:unit:esncard-provider-error'] ?? '';
    const providerErrorUiSource = readSource(
      'src/app/profile/user-profile/user-profile.component.spec.ts',
    );

    expect(playwrightConfig).toContain("name: 'local-chrome-live-esncard'");
    expect(playwrightConfig).toContain("name: 'docs-live-esncard'");
    expect(playwrightConfig).toContain(
      String.raw`testMatch: /specs\/profile\/user-profile-live-esncard\.spec\.ts$/`,
    );
    expect(playwrightConfig).toContain(
      String.raw`const liveEsncardTestTagPattern = /@needs-live-esncard\b/;`,
    );
    expect(playwrightConfig).toContain(
      String.raw`/@needs-(auth0-management|google-maps|live-esncard)\b/`,
    );
    expect(runtimeConfig).toContain("'local-chrome-live-esncard'");
    expect(runtimeConfig).toContain("'docs-live-esncard'");
    expect(providerErrorUiScript).toContain(
      'src/app/profile/user-profile/user-profile.component.spec.ts',
    );
    expect(providerErrorUiScript).toContain('--watch=false');
    expect(providerErrorUiSource).toContain(
      'maps provider and RPC failures to product language',
    );
    expect(providerErrorUiScript).not.toContain('--filter');
    expect(releaseScript).toContain('test:unit:esncard-provider-error');
    expect(releaseScript).toContain('--project=local-chrome-live-esncard');
    expect(releaseScript).toContain('--project=docs-live-esncard');
    expect(releaseScript).toContain('--trace=off');
    expect(releaseScript).toContain(
      '--reporter=./tests/support/reporters/protected-value-sanitizer-reporter.ts,github,dot,./tests/support/reporters/complete-playwright-run-reporter.ts',
    );
  });

  it('keeps both approved identifiers out of traces and value-bearing assertions', () => {
    const liveSpec = readSource(
      'tests/specs/profile/user-profile-live-esncard.spec.ts',
    );
    const liveDocumentation = readSource('tests/docs/profile/discounts.doc.ts');

    expect(liveSpec).toContain("trace: 'off'");
    expect(liveSpec).toContain(
      'savedCard?.identifier === liveEsnCardIdentifier',
    );
    expect(liveSpec).toContain(
      'refreshedCard?.identifier === liveEsnCardIdentifier',
    );
    expect(liveSpec).toContain(
      'savedExpiredCard?.identifier === expiredEsnCardIdentifier',
    );
    expect(liveSpec).toContain(
      'refreshedExpiredCard?.identifier === expiredEsnCardIdentifier',
    );
    expect(liveSpec).toContain(
      'eq(schema.userDiscountCards.tenantId, tenant.id)',
    );
    expect(liveSpec).not.toContain('page.getByText(liveEsnCardIdentifier');
    expect(liveSpec).not.toContain('page.getByText(expiredEsnCardIdentifier');
    expect(liveSpec).not.toContain('identifier: liveEsnCardIdentifier');
    expect(liveDocumentation).toContain("trace: 'off'");
    expect(liveDocumentation).toContain("screenshot: 'off'");
    expect(liveDocumentation).toContain("video: 'off'");
    expect(liveDocumentation).toContain(
      'savedCard?.identifier === liveEsnCardIdentifier',
    );
    expect(liveDocumentation).toContain(
      'savedExpiredCard?.identifier === expiredEsnCardIdentifier',
    );
    expect(liveDocumentation).not.toContain(
      'page.getByText(liveEsnCardIdentifier',
    );
    expect(liveDocumentation).not.toContain(
      'page.getByText(expiredEsnCardIdentifier',
    );
  });

  it('documents both identities, their custody and rotation, and the lack of another provider secret', () => {
    const testGuidance = readSource('tests/README.md');
    const providerSource = readSource(
      'src/server/discounts/providers/index.ts',
    );

    expect(testGuidance).toContain(
      '### Production provider certification credential ownership and rotation',
    );
    expect(testGuidance).toContain('owns both environment secrets');
    expect(testGuidance).toContain(
      'ESNcard-program-approved non-production identities',
    );
    expect(testGuidance).toMatch(
      /Rotate the active\s+identity immediately if it expires, and rotate either identity if it is revoked,\s+changes custodian, may have been disclosed, or no longer produces its expected\s+active or permanently expired outcome/u,
    );
    expect(testGuidance).toContain('replace the affected secret');
    expect(testGuidance).toContain('either value');
    expect(testGuidance).toMatch(
      /requires no API key, OAuth client,\s+or other ESNcard provider credential/u,
    );
    expect(providerSource).toContain(
      'https://esncard.org/services/1.0/card.json?code=',
    );
    expect(providerSource).not.toContain('Authorization');
  });
});
