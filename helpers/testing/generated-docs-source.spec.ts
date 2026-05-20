import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const repositoryRoot = new URL('../..', import.meta.url).pathname;

const readSource = (path: string): string =>
  readFileSync(join(repositoryRoot, path), 'utf8');

describe('generated docs source current behavior', () => {
  it('keeps tenant general-settings docs aligned with implemented branding and legal routes', () => {
    const source = readSource('tests/docs/admin/general-settings.doc.ts');

    expect(source).not.toContain(
      'domain onboarding, brand asset upload, legal text page',
    );
    expect(source).toContain(
      'custom-domain automation, email sender, review policy, registration limit, and Stripe account management gaps',
    );
    expect(source).toContain(
      'hosted text appears at \\`/legal/imprint\\`, \\`/legal/privacy\\`, and \\`/legal/terms\\`',
    );
  });
});
