import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (sourcePath: string): string =>
  fs.readFileSync(path.join(process.cwd(), sourcePath), 'utf8');

describe('ESNcard release certification source', () => {
  it('keeps the manual and reusable certification workflow fail-closed', () => {
    const workflow = readSource(
      '.github/workflows/esncard-release-certification.yml',
    );

    expect(workflow).toContain('workflow_call:');
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('environment: esncard-release-certification');
    expect(workflow).toContain(
      'E2E_LIVE_ESN_CARD_IDENTIFIER: ${{ secrets.E2E_LIVE_ESN_CARD_IDENTIFIER }}',
    );
    expect(workflow).toContain('Require approved release credential');
    expect(workflow).toContain(
      'Missing required environment secret: E2E_LIVE_ESN_CARD_IDENTIFIER',
    );
    expect(workflow).toContain(
      'bun helpers/testing/runtime-preflight.ts esncard-release',
    );
    expect(workflow).toContain('bun run test:e2e:live-esncard:release');
    expect(workflow).toContain(
      'E2E_SELECTED_PROJECTS: local-chrome-live-esncard',
    );
    expect(workflow).not.toContain('actions/upload-artifact');
    expect(workflow).not.toMatch(
      /echo[^\n]*\$\{E2E_LIVE_ESN_CARD_IDENTIFIER\}/u,
    );
  });

  it('blocks the repository release job on live certification', () => {
    const releaseWorkflow = readSource('.github/workflows/release.yml');

    expect(releaseWorkflow).toContain('esncard-provider-certification:');
    expect(releaseWorkflow).toContain(
      'uses: ./.github/workflows/esncard-release-certification.yml',
    );
    expect(releaseWorkflow).toContain('needs: esncard-provider-certification');
    expect(releaseWorkflow).toContain('secrets: inherit');
  });

  it('blocks every main-branch Fly deployment on live certification', () => {
    const deployWorkflow = readSource('.github/workflows/fly-deploy.yml');

    expect(deployWorkflow).toContain('push:');
    expect(deployWorkflow).toContain('- main');
    expect(deployWorkflow).toContain('esncard-provider-certification:');
    expect(deployWorkflow).toContain(
      'uses: ./.github/workflows/esncard-release-certification.yml',
    );
    expect(deployWorkflow).toContain('secrets: inherit');
    expect(deployWorkflow).toMatch(
      /deploy:\n(?: {4}[^\n]*\n)* {4}needs: esncard-provider-certification/u,
    );
    expect(deployWorkflow).toContain('flyctl deploy --remote-only');
    expect(deployWorkflow).not.toContain('E2E_LIVE_ESN_CARD_IDENTIFIER');
  });

  it('runs only the live-provider project plus existing provider-error UI coverage', () => {
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

    expect(playwrightConfig).toContain("name: 'local-chrome-live-esncard'");
    expect(playwrightConfig).toContain(
      String.raw`testMatch: /specs\/profile\/user-profile-live-esncard\.spec\.ts$/`,
    );
    expect(playwrightConfig).toContain(
      String.raw`const liveEsncardTestTagPattern = /@needs-live-esncard\b/;`,
    );
    expect(playwrightConfig).toContain(
      String.raw`/@needs-(auth0-management|cloudflare|google-maps|live-esncard)\b/`,
    );
    expect(runtimeConfig).toContain("'local-chrome-live-esncard'");
    expect(providerErrorUiScript).toContain(
      'src/app/profile/user-profile/user-profile.component.spec.ts',
    );
    expect(providerErrorUiScript).toContain(
      'prefers provider and RPC messages over generic fallback text',
    );
    expect(releaseScript).toContain('test:unit:esncard-provider-error');
    expect(releaseScript).toContain('--project=local-chrome-live-esncard');
    expect(releaseScript).toContain('--trace=off');
    expect(releaseScript).toContain('--reporter=github,dot');
  });

  it('keeps the approved identifier out of traces and value-bearing assertions', () => {
    const liveSpec = readSource(
      'tests/specs/profile/user-profile-live-esncard.spec.ts',
    );

    expect(liveSpec).toContain("trace: 'off'");
    expect(liveSpec).toContain(
      'savedCard?.identifier === liveEsnCardIdentifier',
    );
    expect(liveSpec).toContain(
      'refreshedCard?.identifier === liveEsnCardIdentifier',
    );
    expect(liveSpec).toContain(
      'eq(schema.userDiscountCards.tenantId, tenant.id)',
    );
    expect(liveSpec).not.toContain('page.getByText(liveEsnCardIdentifier');
    expect(liveSpec).not.toContain('identifier: liveEsnCardIdentifier');
  });

  it('documents credential custody, rotation, and the lack of another provider secret', () => {
    const testGuidance = readSource('tests/README.md');
    const providerSource = readSource(
      'src/server/discounts/providers/index.ts',
    );

    expect(testGuidance).toContain(
      '### ESNcard release credential ownership and rotation',
    );
    expect(testGuidance).toContain(
      'ESNcard-program-approved non-production identity',
    );
    expect(testGuidance).toMatch(
      /rotate it immediately when it\s+expires, is revoked, changes custodian, or may have been disclosed/u,
    );
    expect(testGuidance).toMatch(
      /requires no API key, OAuth client,\s+or other ESNcard provider credential/u,
    );
    expect(providerSource).toContain(
      'https://esncard.org/services/1.0/card.json?code=',
    );
    expect(providerSource).not.toContain('Authorization');
  });
});
