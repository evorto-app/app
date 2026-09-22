import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));

const source = (relativePath: string): string =>
  readFileSync(path.join(repositoryRoot, relativePath), 'utf8');

describe('Playwright fail-loud source', () => {
  it('does not disable TLS verification globally', () => {
    expect(source('playwright.config.ts')).not.toContain('ignoreHTTPSErrors');
    expect(
      source('tests/support/utils/authenticated-test-page.ts'),
    ).not.toContain('ignoreHTTPSErrors');
  });

  it('propagates runtime-state and local tenant-routing setup failures', () => {
    const baseFixture = source('tests/support/fixtures/base-test.ts');
    const authenticationSetup = source('tests/setup/authentication.setup.ts');

    expect(baseFixture).toContain('readOptionalE2eRuntimeState(');
    expect(authenticationSetup).toContain('readOptionalE2eRuntimeState(');
    expect(baseFixture).toContain('await routeLocalTenantRequests({');
    expect(baseFixture).toContain('baseUrl: environment.BASE_URL');
    expect(baseFixture).not.toContain('setExtraHTTPHeaders');
    expect(authenticationSetup).toContain('await waitForRuntime();');
    expect(baseFixture).not.toContain("name: 'evorto-tenant'");
    expect(authenticationSetup).not.toContain("name: 'evorto-tenant'");
    expect(baseFixture).not.toContain('} catch {}');
    expect(authenticationSetup).not.toContain('} catch {}');
  });
});
