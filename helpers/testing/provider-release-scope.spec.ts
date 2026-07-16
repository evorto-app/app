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
    const testInventory = source('tests/test-inventory.md');
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
    expect(testInventory).toContain(
      'unrelated Auth0 Management/Google Maps provider',
    );
    expect(testInventory).not.toContain(
      'unrelated Auth0 Management/Cloudflare provider',
    );
    expectLiveProviderTimeout(functionalJourney);
    expectLiveProviderTimeout(documentationJourney);
    expect(documentationJourney).toContain(
      'Google Maps location search must be available',
    );
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

  it('removes Cloudflare Images without removing S3-compatible storage', () => {
    const packageJson = JSON.parse(source('package.json')) as {
      dependencies?: Record<string, string>;
      scripts?: Record<string, string>;
    };
    const compose = source('docker-compose.yml');
    const appRpcs = source(
      'src/shared/rpc-contracts/app-rpcs/app-rpcs.group.ts',
    );
    const runtime = source('src/server/config/runtime-config.ts');
    const objectStorageConfig = source(
      'src/server/config/object-storage-config.ts',
    );
    const objectStorageIntegration = source(
      'src/server/integrations/cloudflare-r2.ts',
    );
    const receiptMedia = source(
      'src/server/effect/rpc/handlers/finance/receipt-media.service.ts',
    );
    const tenantBrandAssets = source('src/server/tenant-brand-assets.ts');
    const tenantBrandAssetHandler = source(
      'src/server/http/tenant-brand-asset.web-handler.ts',
    );
    const server = source('src/server.ts');
    const editor = source(
      'src/app/shared/components/controls/editor/editor.component.ts',
    );

    expect(packageJson.dependencies?.['cloudflare']).toBeUndefined();
    expect(
      packageJson.dependencies?.['@tiptap/extension-file-handler'],
    ).toBeUndefined();
    expect(
      packageJson.scripts?.['test:cleanup:receipt-images'],
    ).toBeUndefined();
    expect(compose).not.toContain('CLOUDFLARE_IMAGES');
    for (const variableName of [
      'S3_ACCESS_KEY_ID',
      'S3_BUCKET',
      'S3_ENDPOINT',
      'S3_REGION',
      'S3_SECRET_ACCESS_KEY',
    ]) {
      expect(compose).toContain(`${variableName}:`);
      expect(objectStorageConfig).toContain(variableName);
    }
    expect(objectStorageConfig).toContain("missingFieldError('S3_BUCKET')");
    expect(objectStorageConfig).not.toContain("onNone: () => 'testing'");
    expect(compose).toContain('S3_PUBLIC_ENDPOINT:');
    expect(objectStorageConfig).toContain('S3_PUBLIC_ENDPOINT');

    expect(objectStorageIntegration).toContain(
      "import { objectStorageConfig } from '../config/object-storage-config';",
    );
    expect(objectStorageIntegration).toContain('export const uploadObjectToR2');
    expect(objectStorageIntegration).toContain('export const getObjectFromR2');
    expect(objectStorageIntegration).toContain(
      'export const receiptObjectExistsInR2',
    );
    expect(objectStorageIntegration).toContain(
      'export const getSignedReceiptObjectUrlFromR2',
    );
    expect(receiptMedia).toContain(
      "from '../../../../integrations/cloudflare-r2';",
    );
    expect(receiptMedia).toContain('uploadReceiptOriginalToR2({');
    expect(receiptMedia).toContain('receiptObjectExistsInR2');
    expect(receiptMedia).toContain('getSignedReceiptObjectUrlFromR2');
    expect(receiptMedia).toContain('export const buildReceiptStorageKey');
    expect(receiptMedia).toContain("'receipts',");
    expect(
      receiptMedia.lastIndexOf('uploadReceiptOriginalToR2({'),
    ).toBeLessThan(receiptMedia.lastIndexOf('objectExists({ storageKey })'));
    expect(tenantBrandAssets).toContain(
      "import { uploadObjectToR2 } from './integrations/cloudflare-r2';",
    );
    expect(tenantBrandAssets).toContain(
      'return `tenant-assets/${tenantId}/${input.kind}/${input.fileName}`;',
    );
    expect(tenantBrandAssets).toContain('yield* uploadObjectToR2({');
    expect(tenantBrandAssetHandler).toContain(
      "import { getObjectFromR2 } from '../integrations/cloudflare-r2';",
    );
    expect(tenantBrandAssetHandler).toContain(
      'const storageKey = tenantBrandAssetStorageKey({',
    );
    expect(tenantBrandAssetHandler).toContain(
      'const body = yield* getObjectFromR2({ key: storageKey })',
    );
    expect(server).toContain("'/tenant-assets/:tenantId/:kind/:fileName'");
    expect(server).toContain('handleTenantBrandAssetWebRequest(asset)');
    expect(runtime).toContain("from './object-storage-config';");
    expect(runtime).toContain('objectStorage: yield* objectStorageStateConfig');
    expect(appRpcs).not.toContain('EditorMediaRpcs');
    expect(runtime).not.toContain('cloudflareImages');
    expect(editor).not.toContain('createImageDirectUpload');
    expect(editor).not.toContain('FileHandler');

    for (const removedPath of [
      'helpers/cleanup-testing-receipt-images.ts',
      'src/server/config/cloudflare-images-config.ts',
      'src/server/effect/rpc/handlers/editor-media.handlers.ts',
      'src/server/integrations/cloudflare-images.ts',
      'src/shared/rpc-contracts/app-rpcs/editor-media.rpcs.ts',
    ]) {
      expect(existsSync(path.join(repositoryRoot, removedPath))).toBe(false);
    }

    for (const preservedBehaviorTest of [
      'src/server/integrations/cloudflare-r2.spec.ts',
      'src/server/effect/rpc/handlers/finance/receipt-media.service.spec.ts',
      'src/server/tenant-brand-assets.spec.ts',
      'src/server/http/tenant-brand-asset.web-handler.spec.ts',
    ]) {
      expect(existsSync(path.join(repositoryRoot, preservedBehaviorTest))).toBe(
        true,
      );
    }
  });
});
