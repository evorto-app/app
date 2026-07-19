import { describe, expect, it } from '@effect/vitest';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  buildDocumentationConsumerBundle,
  documentationConsumerGuideCatalog,
  documentationConsumerGuideSlugs,
} from './documentation-publication-contract';
import {
  assertDocumentationConsumerCurrent,
  assertDocumentationPublishCredentials,
  assertGeneratedDocumentation,
  documentationConsumerEnvironment,
  documentationPublishProjects,
  resolveDocumentationConsumer,
  resolveDocumentationPublishPlaywrightArguments,
  runDocumentationConsumerSync,
} from './publish-documentation';
import { slugifyFolderNameFromTitle } from '../../tests/support/reporters/documentation-reporter/shared';

const writeFixture = (filePath: string, contents: Buffer | string): void => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
};

const runFixtureGit = (
  repositoryRoot: string,
  args: readonly string[],
): string => {
  const result = spawnSync('git', args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr || `git ${args.join(' ')} failed`);
  }
  return result.stdout;
};

const initializeConsumerRepository = (repositoryRoot: string): string => {
  const remoteRoot = path.join(path.dirname(repositoryRoot), 'origin.git');
  runFixtureGit(repositoryRoot, ['init', '--initial-branch=main']);
  runFixtureGit(repositoryRoot, ['add', '.']);
  runFixtureGit(repositoryRoot, [
    '-c',
    'user.name=Evorto Tests',
    '-c',
    'user.email=tests@evorto.invalid',
    'commit',
    '-m',
    'Initialize documentation consumer fixture',
  ]);
  runFixtureGit(path.dirname(repositoryRoot), [
    'init',
    '--bare',
    '--initial-branch=main',
    remoteRoot,
  ]);
  runFixtureGit(repositoryRoot, ['remote', 'add', 'origin', remoteRoot]);
  runFixtureGit(repositoryRoot, ['push', '--set-upstream', 'origin', 'main']);
  return remoteRoot;
};

const advanceConsumerRemote = (
  fixtureRoot: string,
  remoteRoot: string,
): void => {
  const updaterRoot = path.join(fixtureRoot, 'upstream-update');
  runFixtureGit(fixtureRoot, ['clone', remoteRoot, updaterRoot]);
  writeFixture(
    path.join(updaterRoot, 'apps', 'documentation-page', 'package.json'),
    '{"private":true}',
  );
  runFixtureGit(updaterRoot, ['add', '.']);
  runFixtureGit(updaterRoot, [
    '-c',
    'user.name=Evorto Tests',
    '-c',
    'user.email=tests@evorto.invalid',
    'commit',
    '-m',
    'Advance live documentation consumer upstream',
  ]);
  runFixtureGit(updaterRoot, ['push', 'origin', 'main']);
};

const createRawDocumentation = (root: string) => {
  const docs = path.join(root, 'raw-docs');
  const images = path.join(root, 'raw-images');
  fs.mkdirSync(docs);
  fs.mkdirSync(images);
  const sourceSlugs = [
    ...new Set(
      documentationConsumerGuideCatalog.flatMap(({ sourceSlugs }) => [
        ...sourceSlugs,
      ]),
    ),
  ];
  for (const sourceSlug of sourceSlugs) {
    writeFixture(
      path.join(docs, sourceSlug, 'page.md'),
      `---\ntitle: ${JSON.stringify(`Guide ${sourceSlug}`)}\n---\n\nDocumentation for ${sourceSlug}.`,
    );
  }
  const image = Buffer.from('stable fixture image');
  writeFixture(path.join(images, sourceSlugs[0], 'image-fixture.png'), image);
  writeFixture(
    path.join(docs, sourceSlugs[0], 'page.md'),
    `---\ntitle: "Guide with image"\n---\n\n{% figure src="${sourceSlugs[0]}/image-fixture.png" caption="Fixture" /%}`,
  );
  return { docs, image, images, sourceSlugs };
};

const readJson = (filePath: string): Record<string, unknown> => {
  const value: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Expected JSON object at ${filePath}`);
  }
  return value;
};

const expectStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error('Expected an array of strings');
  }
  return value;
};

const readFirstDocumentationTestTitle = (relativePath: string): string => {
  const source = fs.readFileSync(
    path.join(process.cwd(), relativePath),
    'utf8',
  );
  const title = /\btest\(\s*'(?<title>[^']+)'/u.exec(source)?.groups?.['title'];
  if (!title) {
    throw new Error(`Expected a documentation test title in ${relativePath}`);
  }
  return title;
};

describe('documentation publishing', () => {
  it('requires every integration credential before generation starts', () => {
    expect(() =>
      assertDocumentationPublishCredentials({
        AUTH0_MANAGEMENT_CLIENT_ID: 'client-id',
        AUTH0_MANAGEMENT_CLIENT_SECRET: '   ',
        E2E_LIVE_ESN_CARD_EXPIRED_IDENTIFIER: 'expired-card',
        E2E_LIVE_ESN_CARD_IDENTIFIER: 'active-card',
        PUBLIC_GOOGLE_MAPS_API_KEY: 'maps-key',
      }),
    ).toThrow(
      /E2E_DEFAULT_USER_PASSWORD[\s\S]*AUTH0_MANAGEMENT_CLIENT_SECRET/u,
    );
  });

  it('exposes no protected publisher values to the Pages consumer', () => {
    expect(
      documentationConsumerEnvironment({
        AUTH0_MANAGEMENT_CLIENT_SECRET: 'auth0-secret',
        E2E_DEFAULT_USER_PASSWORD: 'password',
        E2E_LIVE_ESN_CARD_IDENTIFIER: 'provider-identity',
        HOME: '/tmp/home',
        PATH: '/usr/bin',
        PUBLIC_GOOGLE_MAPS_API_KEY: 'maps-secret',
        STRIPE_API_KEY: 'stripe-secret',
        TEM_API_TOKEN: 'tem-secret',
      }),
    ).toEqual({ HOME: '/tmp/home', PATH: '/usr/bin' });
  });

  it('runs every documentation project with the documentation reporter in CI', () => {
    expect(documentationPublishProjects).toEqual([
      'docs-baseline',
      'docs-integration',
      'docs-live-esncard',
    ]);
    expect(
      resolveDocumentationPublishPlaywrightArguments({ CI: 'true' }),
    ).toEqual([
      'playwright',
      'test',
      '--project=docs-baseline',
      '--project=docs-integration',
      '--project=docs-live-esncard',
      '--reporter=./tests/support/reporters/protected-value-sanitizer-reporter.ts,github,dot,./tests/support/reporters/documentation-reporter.ts,./tests/support/reporters/complete-playwright-run-reporter.ts',
    ]);
  });

  it('rejects empty staged documentation', () => {
    const fixtureRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'evorto-docs-empty-'),
    );
    const docs = path.join(fixtureRoot, 'docs');
    const images = path.join(fixtureRoot, 'images');
    fs.mkdirSync(docs);
    fs.mkdirSync(images);

    try {
      expect(() => assertGeneratedDocumentation(docs, images)).toThrow(
        'contains no page.md files',
      );
    } finally {
      fs.rmSync(fixtureRoot, { force: true, recursive: true });
    }
  });

  it('builds the exact versioned Evorto Pages consumer bundle', () => {
    expect(documentationConsumerGuideSlugs).toEqual([
      'complete-your-profile',
      'find-an-event',
      'register-for-an-event',
      'manage-your-registration',
      'create-an-event',
      'submit-an-event-for-approval',
      'run-an-event',
      'first-steps',
      'manage-your-tenant',
      'create-an-event-template',
      'manage-section-users',
      'configure-user-data',
      'review-and-publish-an-event',
    ]);
    expect(
      documentationConsumerGuideCatalog.find(
        (guide) => guide.id === 'evorto:find-an-event',
      )?.sourceSlugs,
    ).toEqual([
      'find-a-listed-event',
      'user-understanding-unlisted-events',
      'admin-manage-unlisted-events',
      'recover-from-an-unknown-organization-link',
    ]);
    const fixtureRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'evorto-docs-consumer-bundle-'),
    );
    const raw = createRawDocumentation(fixtureRoot);
    const outputRoot = path.join(fixtureRoot, 'consumer');

    try {
      buildDocumentationConsumerBundle({
        outputRoot,
        rawDocsRoot: raw.docs,
        rawImagesRoot: raw.images,
      });

      const contentRoot = path.join(outputRoot, 'content');
      const assetsRoot = path.join(outputRoot, 'assets');
      const bundle = readJson(path.join(contentRoot, 'docs-tests.bundle.json'));
      const manifest = readJson(
        path.join(contentRoot, '.docs-tests-manifest.json'),
      );
      expect(bundle['schemaVersion']).toBe('docs-tests.bundle/v1alpha1');
      const guides = bundle['guides'];
      if (!Array.isArray(guides)) throw new Error('Expected bundle guides');
      expect(
        guides.map((guide) => {
          if (!guide || typeof guide !== 'object' || !('slug' in guide)) {
            throw new Error('Expected a guide slug');
          }
          return guide.slug;
        }),
      ).toEqual(documentationConsumerGuideSlugs);
      expect(manifest['schemaVersion']).toBe(
        'docs-tests.output-manifest/v1alpha1',
      );
      expect(expectStringArray(manifest['docs']).sort()).toEqual(
        [
          ...documentationConsumerGuideSlugs.map((slug) => `${slug}/page.md`),
          'docs-tests.bundle.json',
        ].sort(),
      );

      const firstTargetSlug = documentationConsumerGuideCatalog[0].slug;
      const firstImagePath = `${firstTargetSlug}/image-fixture.png`;
      expect(expectStringArray(manifest['images'])).toContain(firstImagePath);
      expect(
        fs.readFileSync(
          path.join(contentRoot, firstTargetSlug, 'page.md'),
          'utf8',
        ),
      ).toContain(`src="${firstTargetSlug}/image-fixture.png"`);
      expect(
        fs.readFileSync(
          path.join(assetsRoot, firstTargetSlug, 'image-fixture.png'),
        ),
      ).toEqual(raw.image);

      const contentHashes = manifest['contentHashes'];
      if (
        !contentHashes ||
        typeof contentHashes !== 'object' ||
        !('images' in contentHashes) ||
        !contentHashes.images ||
        typeof contentHashes.images !== 'object'
      ) {
        throw new Error('Expected manifest image hashes');
      }
      const expectedHash = `sha256:${crypto
        .createHash('sha256')
        .update(raw.image)
        .digest('hex')}`;
      expect(
        Object.entries(contentHashes.images).find(
          ([relativePath]) => relativePath === firstImagePath,
        )?.[1],
      ).toBe(expectedHash);
    } finally {
      fs.rmSync(fixtureRoot, { force: true, recursive: true });
    }
  });

  it('keeps title-derived publication folders aligned with the catalog', () => {
    for (const fixture of [
      {
        file: 'tests/docs/admin/platform-tenant-operations.doc.ts',
        guideId: 'evorto:manage-your-tenant',
      },
      {
        file: 'tests/docs/roles/roles.doc.ts',
        guideId: 'evorto:manage-section-users',
      },
    ]) {
      const sourceSlug = slugifyFolderNameFromTitle(
        readFirstDocumentationTestTitle(fixture.file),
      );
      const guide = documentationConsumerGuideCatalog.find(
        ({ id }) => id === fixture.guideId,
      );
      expect(guide?.sourceSlugs).toContain(sourceSlug);
    }
  });

  it('normalizes generated headings and rewrites source-guide links', () => {
    const fixtureRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'evorto-docs-markdown-normalization-'),
    );
    const raw = createRawDocumentation(fixtureRoot);
    writeFixture(
      path.join(
        raw.docs,
        'transfer-a-registration-with-a-private-offer',
        'page.md',
      ),
      [
        '---',
        'title: "Transfer a registration with a private offer"',
        '---',
        '',
        '# Transfer a registration',
        '',
        '## What paid transfers add',
        '',
        'Continue with [Complete a paid registration transfer](/docs/complete-a-paid-transfer-and-retry-a-failed-refund).',
        'Start with [Transfer a registration with a private offer](/docs/transfer-a-registration-with-a-private-offer).',
        'Learn how to [manage categories](/docs/manage-template-categories).',
        'Review [Participant registration cancellation](/docs/participant-registration-cancellation).',
        'Learn more at [about permissions](/docs/about-permissions).',
        '',
        '```md',
        '# Example source heading',
        '[Example source link](/docs/example-only)',
        '```',
      ].join('\n'),
    );
    const outputRoot = path.join(fixtureRoot, 'consumer');

    try {
      buildDocumentationConsumerBundle({
        outputRoot,
        rawDocsRoot: raw.docs,
        rawImagesRoot: raw.images,
      });
      const page = fs.readFileSync(
        path.join(outputRoot, 'content', 'manage-your-registration', 'page.md'),
        'utf8',
      );

      expect(page).toContain('## Transfer a registration with a private offer');
      expect(page).toContain('### Transfer a registration');
      expect(page).toContain('#### What paid transfers add');
      expect(page).toContain('](/docs/manage-your-registration)');
      expect(page).toContain('](/docs/create-an-event-template)');
      expect(page).toContain('](/docs/manage-your-tenant)');
      expect(page).not.toMatch(
        /\/docs\/(?:complete-a-paid-transfer|transfer-a-registration|manage-template-categories|participant-registration-cancellation|about-permissions)/u,
      );
      expect(page).toContain(
        '```md\n# Example source heading\n[Example source link](/docs/example-only)\n```',
      );
    } finally {
      fs.rmSync(fixtureRoot, { force: true, recursive: true });
    }
  });

  it('fails closed for unknown and ambiguous generated documentation links', () => {
    const fixtureRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'evorto-docs-link-validation-'),
    );
    const raw = createRawDocumentation(fixtureRoot);
    const sourcePage = path.join(
      raw.docs,
      'transfer-a-registration-with-a-private-offer',
      'page.md',
    );

    try {
      writeFixture(
        sourcePage,
        '---\ntitle: Unknown guide\n---\n\n[Unknown](/docs/not-in-the-publication-catalog).',
      );
      expect(() =>
        buildDocumentationConsumerBundle({
          outputRoot: path.join(fixtureRoot, 'unknown-consumer'),
          rawDocsRoot: raw.docs,
          rawImagesRoot: raw.images,
        }),
      ).toThrow(
        'references an unknown guide: /docs/not-in-the-publication-catalog',
      );

      writeFixture(
        sourcePage,
        '---\ntitle: Ambiguous guide\n---\n\n[Approval](/docs/event-approval-workflow).',
      );
      expect(() =>
        buildDocumentationConsumerBundle({
          outputRoot: path.join(fixtureRoot, 'ambiguous-consumer'),
          rawDocsRoot: raw.docs,
          rawImagesRoot: raw.images,
        }),
      ).toThrow(
        'references an ambiguous source guide: /docs/event-approval-workflow',
      );
    } finally {
      fs.rmSync(fixtureRoot, { force: true, recursive: true });
    }
  });

  it('fails closed when generated guide inventory drifts from the catalog', () => {
    const fixtureRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'evorto-docs-catalog-drift-'),
    );
    const raw = createRawDocumentation(fixtureRoot);
    writeFixture(
      path.join(raw.docs, 'unmapped-guide', 'page.md'),
      '---\ntitle: Unmapped\n---\n\nUnmapped guide.',
    );

    try {
      expect(() =>
        buildDocumentationConsumerBundle({
          outputRoot: path.join(fixtureRoot, 'consumer'),
          rawDocsRoot: raw.docs,
          rawImagesRoot: raw.images,
        }),
      ).toThrow(/Unexpected: unmapped-guide\/page\.md/u);
    } finally {
      fs.rmSync(fixtureRoot, { force: true, recursive: true });
    }
  });

  it('fails closed when a generated guide references a missing image', () => {
    const fixtureRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'evorto-docs-missing-image-'),
    );
    const raw = createRawDocumentation(fixtureRoot);
    writeFixture(
      path.join(raw.docs, raw.sourceSlugs[0], 'page.md'),
      `---\ntitle: Missing image\n---\n\n{% figure src="${raw.sourceSlugs[0]}/missing.png" caption="Missing" /%}`,
    );

    try {
      expect(() =>
        buildDocumentationConsumerBundle({
          outputRoot: path.join(fixtureRoot, 'consumer'),
          rawDocsRoot: raw.docs,
          rawImagesRoot: raw.images,
        }),
      ).toThrow(/Generated documentation image references[\s\S]*missing\.png/u);
    } finally {
      fs.rmSync(fixtureRoot, { force: true, recursive: true });
    }
  });

  it('requires the explicit tracked Evorto Pages consumer root', () => {
    expect(() => resolveDocumentationConsumer({})).toThrow(
      'requires EVORTO_PAGES_ROOT',
    );

    const fixtureContainer = fs.mkdtempSync(
      path.join(os.tmpdir(), 'evorto-pages-consumer-'),
    );
    const fixtureRoot = path.join(fixtureContainer, 'consumer');
    fs.mkdirSync(fixtureRoot);
    writeFixture(
      path.join(fixtureRoot, 'tools', 'docs', 'sync-generated-docs.mjs'),
      '// fixture sync tool',
    );
    fs.mkdirSync(path.join(fixtureRoot, 'apps', 'documentation-page'), {
      recursive: true,
    });
    writeFixture(
      path.join(fixtureRoot, 'apps', 'documentation-page', 'package.json'),
      '{}',
    );
    initializeConsumerRepository(fixtureRoot);
    try {
      expect(
        resolveDocumentationConsumer({ EVORTO_PAGES_ROOT: fixtureRoot }),
      ).toEqual({
        repositoryRoot: fixtureRoot,
        syncScript: path.join(
          fixtureRoot,
          'tools',
          'docs',
          'sync-generated-docs.mjs',
        ),
      });

      expect(() =>
        assertDocumentationConsumerCurrent({
          head: 'current',
          liveUpstream: 'current',
          status: '?? untracked.txt',
        }),
      ).toThrow('checkout must be clean');
      expect(() =>
        assertDocumentationConsumerCurrent({
          head: 'local-change',
          liveUpstream: 'upstream',
          status: '',
        }),
      ).toThrow('must match its configured upstream tip');
    } finally {
      fs.rmSync(fixtureContainer, { force: true, recursive: true });
    }
  }, 45_000);

  it('rejects a live upstream advance hidden by a stale tracking ref before sync', () => {
    const fixtureContainer = fs.mkdtempSync(
      path.join(os.tmpdir(), 'evorto-pages-stale-upstream-'),
    );
    const fixtureRoot = path.join(fixtureContainer, 'consumer');
    const syncScript = path.join(
      fixtureRoot,
      'tools',
      'docs',
      'sync-generated-docs.mjs',
    );
    const syncMarker = path.join(fixtureRoot, 'sync-ran.txt');
    fs.mkdirSync(fixtureRoot);
    writeFixture(
      syncScript,
      `import fs from 'node:fs';\nfs.writeFileSync(${JSON.stringify(syncMarker)}, 'ran');\n`,
    );
    writeFixture(
      path.join(fixtureRoot, 'apps', 'documentation-page', 'package.json'),
      '{}',
    );
    const remoteRoot = initializeConsumerRepository(fixtureRoot);

    try {
      const consumer = resolveDocumentationConsumer({
        EVORTO_PAGES_ROOT: fixtureRoot,
      });

      advanceConsumerRemote(fixtureContainer, remoteRoot);

      expect(() =>
        runDocumentationConsumerSync({
          repositoryRoot: consumer.repositoryRoot,
          sourceRoot: fixtureContainer,
          syncScript: consumer.syncScript,
        }),
      ).toThrow('must match its configured upstream tip from the live remote');
      expect(fs.existsSync(syncMarker)).toBe(false);
    } finally {
      fs.rmSync(fixtureContainer, { force: true, recursive: true });
    }
  }, 45_000);

  it('does not hard-code or directly replace an Evorto Pages checkout', () => {
    const packageJson: unknown = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'),
    );
    if (
      !packageJson ||
      typeof packageJson !== 'object' ||
      !('scripts' in packageJson) ||
      !packageJson.scripts ||
      typeof packageJson.scripts !== 'object' ||
      !('test:e2e:docs:publish' in packageJson.scripts)
    ) {
      throw new Error('Expected documentation publication package script');
    }
    const publishScript = packageJson.scripts['test:e2e:docs:publish'];
    expect(publishScript).toBe(
      'bun run env:runtime && dotenv -c dev -- bun helpers/testing/publish-documentation.ts',
    );
    expect(publishScript).not.toContain('/Users/');
    expect(publishScript).not.toContain('apps/documentation');
    for (const sourceFile of [
      'helpers/testing/documentation-publication-contract.ts',
      'helpers/testing/publish-documentation.ts',
    ]) {
      const sourceStat = fs.lstatSync(path.join(process.cwd(), sourceFile));
      expect(sourceStat.isFile()).toBe(true);
      expect(sourceStat.isSymbolicLink()).toBe(false);
    }
  });
});
