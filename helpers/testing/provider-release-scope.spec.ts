import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));
const source = (relativePath: string): string =>
  readFileSync(path.join(repositoryRoot, relativePath), 'utf8');

const expectLiveProviderTimeout = (testSource: string): void => {
  const timeout = /test\.setTimeout\((\d[\d_]*)\)/u.exec(testSource)?.[1];

  expect(timeout).toBeDefined();
  expect(Number(timeout?.replaceAll('_', ''))).toBeGreaterThanOrEqual(60_000);
};

describe('production provider scope', () => {
  it('keeps Google Maps in the integration release contract', () => {
    const packageJson = JSON.parse(source('package.json')) as {
      dependencies?: Record<string, string>;
    };
    const playwright = source('playwright.config.ts');
    const runtime = source('src/server/config/test-runtime-config.ts');
    const releaseWorkflow = source(
      '.github/workflows/esncard-release-certification.yml',
    );
    const functionalJourney = source(
      'tests/specs/admin/google-maps-location.spec.ts',
    );
    const documentationJourney = source(
      'tests/docs/admin/google-maps-location.doc.ts',
    );
    const releaseGuides = [
      source('README.md'),
      source('QUALITY.md'),
      source('tests/README.md'),
    ];

    expect(
      packageJson.dependencies?.['@googlemaps/js-api-loader'],
    ).toBeTruthy();
    expect(source('docker-compose.yml')).toContain(
      'PUBLIC_GOOGLE_MAPS_API_KEY:',
    );
    expect(playwright).toContain('@needs-(auth0-management|google-maps)');
    expect(playwright).toContain(
      "createModeProject('local-chrome-integration'",
    );
    expect(playwright).toContain("createModeProject('docs-integration'");
    expect(runtime).toContain("'PUBLIC_GOOGLE_MAPS_API_KEY'");
    expect(releaseWorkflow).toContain(
      'AUTH0_MANAGEMENT_CLIENT_ID: ${{ secrets.AUTH0_MANAGEMENT_CLIENT_ID }}',
    );
    expect(releaseWorkflow).toContain(
      'AUTH0_MANAGEMENT_CLIENT_SECRET: ${{ secrets.AUTH0_MANAGEMENT_CLIENT_SECRET }}',
    );
    expect(releaseWorkflow).toContain(
      'PUBLIC_GOOGLE_MAPS_API_KEY: ${{ secrets.PUBLIC_GOOGLE_MAPS_API_KEY }}',
    );
    expect(releaseWorkflow).toContain(
      'name: Production Provider Certification',
    );
    expect(releaseWorkflow).toContain('group: provider-certification');
    expect(releaseWorkflow).not.toContain(
      'provider-certification-${{ github.ref }}',
    );
    expect(releaseWorkflow).toContain(
      'STRIPE_API_KEY: ${{ secrets.STRIPE_TEST_API_KEY }}',
    );
    const credentialValidation = releaseWorkflow
      .split('\n')
      .find((line) => line.includes('for variable_name in'));
    for (const variableName of [
      'AUTH0_MANAGEMENT_CLIENT_ID',
      'AUTH0_MANAGEMENT_CLIENT_SECRET',
      'PUBLIC_GOOGLE_MAPS_API_KEY',
    ]) {
      expect(credentialValidation).toContain(variableName);
    }
    expect(releaseWorkflow).toContain(
      'E2E_SELECTED_PROJECTS: local-chrome-integration,docs-integration',
    );
    expect(releaseWorkflow).toContain('bun run test:e2e:integration');
    expect(
      releaseWorkflow.indexOf('bun run test:e2e:integration'),
    ).toBeLessThan(
      releaseWorkflow.indexOf('bun run test:e2e:live-esncard:release'),
    );
    for (const releaseGuide of releaseGuides) {
      expect(releaseGuide).toContain('bun run test:e2e:integration');
      expect(releaseGuide).toContain('bun run test:e2e:live-esncard:release');
      expect(releaseGuide).toContain('ESNcard provider portion');
      expect(releaseGuide).toContain('Production Provider Certification');
      expect(releaseGuide).toMatch(/before CI\s+is attempted/u);
    }
    expect(functionalJourney).toContain('@needs-google-maps');
    expect(documentationJourney).toContain('@needs-google-maps');
    expectLiveProviderTimeout(functionalJourney);
    expectLiveProviderTimeout(documentationJourney);
    expect(documentationJourney).toContain('Location search must be available');
    for (const prerequisite of [
      'billing enabled',
      'Maps JavaScript API',
      'Places API (New)',
    ]) {
      expect(source('tests/README.md')).toContain(prerequisite);
    }
    expect(
      existsSync(
        path.join(
          repositoryRoot,
          'tests/specs/admin/google-maps-location.spec.ts',
        ),
      ),
    ).toBe(true);
    expect(
      existsSync(
        path.join(
          repositoryRoot,
          'tests/docs/admin/google-maps-location.doc.ts',
        ),
      ),
    ).toBe(true);
  });
});
