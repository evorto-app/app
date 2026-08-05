import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {
  generatedGuideLanguageViolations,
  generatedGuideLevelOneHeadingViolations,
} from './generated-docs-language';

export const documentationConsumerGuideCatalog = [
  {
    id: 'evorto:complete-your-profile',
    slug: 'complete-your-profile',
    sourceSlugs: [
      'manage-your-profile',
      'understand-your-esncard-status',
      'manage-esncard',
      'check-your-esncard',
    ],
    title: 'Complete your profile',
  },
  {
    id: 'evorto:find-an-event',
    slug: 'find-an-event',
    sourceSlugs: [
      'find-an-event-you-can-join',
      'choose-who-can-find-an-announcement',
      'recover-from-an-unknown-organization-link',
    ],
    title: 'Find an event',
  },
  {
    id: 'evorto:sign-up-for-an-event',
    slug: 'sign-up-for-an-event',
    sourceSlugs: [
      'sign-up-for-events',
      'when-you-cannot-sign-up',
      'manual-approval-sign-ups',
    ],
    title: 'Sign up for an event',
  },
  {
    id: 'evorto:manage-your-ticket',
    slug: 'manage-your-ticket',
    sourceSlugs: [
      'cancel-a-ticket',
      'cancel-an-attendee-as-an-organizer',
      'transfer-your-ticket-privately',
      'finish-a-paid-transfer-and-resolve-a-refund-problem',
    ],
    title: 'Manage your ticket',
  },
  {
    id: 'evorto:create-an-event',
    slug: 'create-an-event',
    sourceSlugs: ['create-and-manage-events'],
    title: 'Create an event',
  },
  {
    id: 'evorto:submit-an-event-for-approval',
    slug: 'submit-an-event-for-approval',
    sourceSlugs: ['review-and-publish-an-event'],
    title: 'Submit an event for approval',
  },
  {
    id: 'evorto:run-an-event',
    slug: 'run-an-event',
    sourceSlugs: [
      'organizer-and-helper-sign-up',
      'check-in-event-attendees',
      'hand-out-add-ons-from-a-scanned-ticket',
    ],
    title: 'Run an event',
  },
  {
    id: 'evorto:first-steps',
    slug: 'first-steps',
    sourceSlugs: [
      'understand-organization-account-setup',
      'create-your-account',
      'join-another-organization-and-choose-your-home-organization',
      'choose-what-members-need-to-provide',
    ],
    title: 'First steps',
  },
  {
    id: 'evorto:manage-your-organization',
    slug: 'manage-your-organization',
    sourceSlugs: [
      'manage-organization-settings',
      'publish-legal-pages',
      'choose-an-organization-default-location',
      'manage-finances',
      'review-and-reimburse-receipts',
      'submit-an-event-receipt',
      'review-email-delivery-across-organizations',
      'manage-organizations',
      'manage-one-organization-and-review-change-history',
      'about-permissions',
    ],
    title: 'Manage your organization',
  },
  {
    id: 'evorto:create-an-event-template',
    slug: 'create-an-event-template',
    sourceSlugs: [
      'manage-template-categories',
      'manage-templates',
      'manage-tax-rates',
      'use-tax-rates-for-paid-sign-ups',
    ],
    title: 'Create an event template',
  },
  {
    id: 'evorto:manage-organization-members',
    slug: 'manage-organization-members',
    sourceSlugs: ['manage-members-and-roles'],
    title: 'Manage organization members',
  },
  {
    id: 'evorto:member-information',
    slug: 'member-information',
    sourceSlugs: ['choose-what-members-need-to-provide'],
    title: 'Choose what members need to provide',
  },
  {
    id: 'evorto:review-and-publish-an-event',
    slug: 'review-and-publish-an-event',
    sourceSlugs: [
      'review-and-publish-an-event',
      'choose-who-can-find-an-announcement',
    ],
    title: 'Review and publish an event',
  },
] as const;

export const documentationConsumerGuideSlugs =
  documentationConsumerGuideCatalog.map(({ slug }) => slug);

const bundleFileName = 'docs-tests.bundle.json';
const manifestFileName = '.docs-tests-manifest.json';
const pageFileName = 'page.md';
const outputManifestSchema = 'docs-tests.output-manifest/v1alpha1';
const bundleSchema = 'docs-tests.bundle/v1alpha1';
const allowedImageTypes = new Map([
  ['.gif', 'image/gif'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
]);

interface DocumentationAsset {
  id: string;
  integrity: string;
  mediaType: string;
  outputPath: string;
}

interface GeneratedDocumentationBundle {
  assets: DocumentationAsset[];
  guides: Array<{
    id: string;
    metadata: Record<string, never>;
    sections: never[];
    slug: string;
    title: string;
  }>;
  schemaVersion: typeof bundleSchema;
}

const assertRealDirectory = (directory: string, label: string): void => {
  const stat = fs.lstatSync(directory, { throwIfNoEntry: false });
  if (!stat?.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`${label} must be a real directory: ${directory}`);
  }
};

const assertSafeRelativePath = (relativePath: string, label: string): void => {
  if (
    !relativePath ||
    path.isAbsolute(relativePath) ||
    relativePath.includes('\\') ||
    relativePath.split('/').some((segment) => !segment || segment === '..')
  ) {
    throw new Error(`${label} contains an unsafe path: ${relativePath}`);
  }
};

const listFiles = (root: string): string[] => {
  const files: string[] = [];
  const walk = (directory: string, relativeDirectory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const relativePath = relativeDirectory
        ? `${relativeDirectory}/${entry.name}`
        : entry.name;
      assertSafeRelativePath(relativePath, 'Generated documentation');
      const entryPath = path.join(directory, entry.name);
      const stat = fs.lstatSync(entryPath);
      if (stat.isSymbolicLink()) {
        throw new Error(
          `Generated documentation must not contain symbolic links: ${relativePath}`,
        );
      }
      if (stat.isDirectory()) {
        walk(entryPath, relativePath);
        continue;
      }
      if (!stat.isFile()) {
        throw new Error(
          `Generated documentation must contain regular files: ${relativePath}`,
        );
      }
      files.push(relativePath);
    }
  };

  walk(root, '');
  return files.sort((left, right) => left.localeCompare(right));
};

const assertExactSet = (
  actualValues: readonly string[],
  expectedValues: readonly string[],
  label: string,
): void => {
  const actual = [...new Set(actualValues)].sort();
  const expected = [...new Set(expectedValues)].sort();
  if (
    actual.length !== actualValues.length ||
    expected.length !== expectedValues.length ||
    actual.length !== expected.length ||
    actual.some((value, index) => value !== expected[index])
  ) {
    const missing = expected.filter((value) => !actual.includes(value));
    const unexpected = actual.filter((value) => !expected.includes(value));
    throw new Error(
      `${label} does not match the publication catalog.` +
        (missing.length > 0 ? ` Missing: ${missing.join(', ')}.` : '') +
        (unexpected.length > 0 ? ` Unexpected: ${unexpected.join(', ')}.` : ''),
    );
  }
};

const fileHash = (filePath: string, separator: ':' | '-'): string =>
  `sha256${separator}${crypto
    .createHash('sha256')
    .update(fs.readFileSync(filePath))
    .digest('hex')}`;

const outputRootFingerprint = (root: string): string =>
  `sha256:${crypto
    .createHash('sha256')
    .update(fs.realpathSync.native(root))
    .digest('hex')}`;

const readSourcePage = (
  docsRoot: string,
  sourceSlug: string,
): { body: string; title: string } => {
  const pagePath = path.join(docsRoot, sourceSlug, pageFileName);
  const page = fs.readFileSync(pagePath, 'utf8');
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---\s*/u.exec(page);
  if (!frontmatter) {
    throw new Error(`Generated page has no frontmatter: ${sourceSlug}`);
  }
  const titleValue = /^title:\s*(.+)$/mu.exec(frontmatter[1])?.[1]?.trim();
  if (!titleValue) {
    throw new Error(`Generated page has no title: ${sourceSlug}`);
  }
  let title = titleValue;
  if (titleValue.startsWith('"')) {
    const parsed = JSON.parse(titleValue);
    if (typeof parsed !== 'string' || !parsed.trim()) {
      throw new Error(`Generated page has an invalid title: ${sourceSlug}`);
    }
    title = parsed;
  }
  const body = page.slice(frontmatter[0].length).trim();
  if (!body) {
    throw new Error(`Generated page is empty: ${sourceSlug}`);
  }
  return { body, title };
};

const rewriteAssetReferences = (
  markdown: string,
  sourceSlug: string,
  targetSlug: string,
): string =>
  markdown
    .split(`(${sourceSlug}/`)
    .join(`(${targetSlug}/`)
    .split(`src="${sourceSlug}/`)
    .join(`src="${targetSlug}/`);

const sourceHeading =
  /^(?<indent> {0,3})(?<marks>#{1,6})(?<space>[\t ]+)(?<text>.*)$/u;
const fence = /^(?<indent> {0,3})(?<marks>`{3,}|~{3,})(?<tail>.*)$/u;

const stripReporterOwnedTitleHeading = (
  markdown: string,
  title: string,
): string => {
  const lines = markdown.split('\n');
  const firstContentLine = lines.findIndex((line) => line.trim().length > 0);
  if (firstContentLine < 0 || lines[firstContentLine] !== `# ${title}`) {
    return markdown;
  }

  lines.splice(firstContentLine, 1);
  return lines.join('\n').trim();
};

const mapMarkdownOutsideFences = (
  markdown: string,
  transform: (line: string) => string,
): string => {
  let activeFence: { marker: '`' | '~'; width: number } | undefined;
  return markdown
    .split('\n')
    .map((line) => {
      const fenceMatch = fence.exec(line);
      const fenceMarks = fenceMatch?.groups?.['marks'];
      if (fenceMarks) {
        const marker = fenceMarks[0];
        if (marker !== '`' && marker !== '~') {
          throw new Error('Generated documentation contains an invalid fence');
        }
        if (!activeFence) {
          activeFence = { marker, width: fenceMarks.length };
        } else if (
          marker === activeFence.marker &&
          fenceMarks.length >= activeFence.width &&
          !fenceMatch.groups?.['tail']?.trim()
        ) {
          activeFence = undefined;
        }
        return line;
      }
      return activeFence ? line : transform(line);
    })
    .join('\n');
};

const normalizeSourceHeadings = (markdown: string): string => {
  let shallowestHeading = 7;
  mapMarkdownOutsideFences(markdown, (line) => {
    const marks = sourceHeading.exec(line)?.groups?.['marks'];
    if (marks) shallowestHeading = Math.min(shallowestHeading, marks.length);
    return line;
  });
  const headingShift = Math.max(0, 3 - shallowestHeading);
  if (headingShift === 0) return markdown;

  return mapMarkdownOutsideFences(markdown, (line) => {
    const match = sourceHeading.exec(line);
    const groups = match?.groups;
    const marks = groups?.['marks'];
    if (!groups || !marks) return line;
    return `${groups['indent']}${'#'.repeat(Math.min(6, marks.length + headingShift))}${groups['space']}${groups['text']}`;
  });
};

const internalDocumentationReference =
  /\/docs\/(?<slug>[a-z0-9]+(?:-[a-z0-9]+)*)(?=[/?#)"'\s]|$)/gu;

const rewriteInternalDocumentationReferences = (markdown: string): string => {
  const targetSlugs = new Set(documentationConsumerGuideSlugs);
  const sourceTargets = new Map<string, Set<string>>();
  for (const guide of documentationConsumerGuideCatalog) {
    for (const sourceReference of guide.sourceSlugs) {
      const targets = sourceTargets.get(sourceReference) ?? new Set<string>();
      targets.add(guide.slug);
      sourceTargets.set(sourceReference, targets);
    }
  }

  return mapMarkdownOutsideFences(markdown, (line) =>
    line.replace(
      internalDocumentationReference,
      (reference, ...replacementArguments: unknown[]) => {
        const groups = replacementArguments.at(-1);
        if (!groups || typeof groups !== 'object' || !('slug' in groups)) {
          throw new Error(
            `Generated documentation contains an invalid internal reference: ${reference}`,
          );
        }
        const slug = groups.slug;
        if (typeof slug !== 'string') {
          throw new Error(
            `Generated documentation contains an invalid internal reference: ${reference}`,
          );
        }
        if (targetSlugs.has(slug)) return reference;
        const targets = sourceTargets.get(slug);
        if (!targets || targets.size === 0) {
          throw new Error(
            `Generated documentation references an unknown guide: ${reference}`,
          );
        }
        if (targets.size > 1) {
          throw new Error(
            `Generated documentation references an ambiguous source guide: ${reference}. Use one of: ${[...targets].sort().join(', ')}`,
          );
        }
        const [target] = targets;
        if (!target || !targetSlugs.has(target)) {
          throw new Error(
            `Generated documentation references an invalid consumer guide: ${reference}`,
          );
        }
        return `/docs/${target}`;
      },
    ),
  );
};

const collectLocalImageReferences = (markdown: string): string[] => {
  const references = [
    ...[...markdown.matchAll(/!\[[^\]]*\]\(([^)]+)\)/gu)].map(
      (match) => match[1],
    ),
    ...[
      ...markdown.matchAll(/\{%\s+figure\s+[^%]*src="([^"]+)"[^%]*%\}/gu),
    ].map((match) => match[1]),
  ];

  for (const reference of references) {
    assertSafeRelativePath(
      reference,
      'Generated documentation image reference',
    );
  }
  return references;
};

const copySourceAssets = (
  sourceSlug: string,
  targetSlug: string,
  sourceAssetsRoot: string,
  targetAssetsRoot: string,
  assetsByOutputPath: Map<string, DocumentationAsset>,
): void => {
  const sourceDirectory = path.join(sourceAssetsRoot, sourceSlug);
  if (!fs.existsSync(sourceDirectory)) return;
  assertRealDirectory(sourceDirectory, 'Generated guide image directory');

  for (const relativePath of listFiles(sourceDirectory)) {
    const extension = path.posix.extname(relativePath).toLowerCase();
    const mediaType = allowedImageTypes.get(extension);
    if (!mediaType) {
      throw new Error(
        `Generated documentation contains an unsupported image: ${sourceSlug}/${relativePath}`,
      );
    }
    const sourcePath = path.join(sourceDirectory, ...relativePath.split('/'));
    const outputPath = `${targetSlug}/${relativePath}`;
    const targetPath = path.join(targetAssetsRoot, ...outputPath.split('/'));
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    if (fs.existsSync(targetPath)) {
      if (fileHash(sourcePath, '-') !== fileHash(targetPath, '-')) {
        throw new Error(`Generated image collision: ${outputPath}`);
      }
    } else {
      fs.copyFileSync(sourcePath, targetPath, fs.constants.COPYFILE_EXCL);
    }
    const integrity = fileHash(sourcePath, '-');
    assetsByOutputPath.set(outputPath, {
      id: `asset:${outputPath}`,
      integrity,
      mediaType,
      outputPath,
    });
  }
};

const writeJson = (filePath: string, value: unknown): void => {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
};

export const buildDocumentationConsumerBundle = (input: {
  outputRoot: string;
  rawDocsRoot: string;
  rawImagesRoot: string;
}): void => {
  assertRealDirectory(input.rawDocsRoot, 'Generated documentation directory');
  assertRealDirectory(input.rawImagesRoot, 'Generated image directory');
  if (fs.existsSync(input.outputRoot)) {
    throw new Error(
      `Documentation consumer bundle output already exists: ${input.outputRoot}`,
    );
  }

  const targetSlugs = documentationConsumerGuideCatalog.map(({ slug }) => slug);
  assertExactSet(
    targetSlugs,
    documentationConsumerGuideSlugs,
    'Documentation consumer guide slugs',
  );
  const sourceSlugs = [
    ...new Set(
      documentationConsumerGuideCatalog.flatMap(({ sourceSlugs: sources }) => [
        ...sources,
      ]),
    ),
  ];
  const rawDocsFiles = listFiles(input.rawDocsRoot);
  assertExactSet(
    rawDocsFiles,
    sourceSlugs.map((slug) => `${slug}/${pageFileName}`),
    'Generated documentation pages',
  );
  const rawImageFiles = listFiles(input.rawImagesRoot);
  for (const imagePath of rawImageFiles) {
    const [sourceSlug] = imagePath.split('/');
    if (!sourceSlug || !sourceSlugs.includes(sourceSlug)) {
      throw new Error(
        `Generated image is not owned by a publication guide: ${imagePath}`,
      );
    }
  }

  const contentRoot = path.join(input.outputRoot, 'content');
  const assetsRoot = path.join(input.outputRoot, 'assets');
  fs.mkdirSync(contentRoot, { recursive: true });
  fs.mkdirSync(assetsRoot, { recursive: true });
  const assetsByOutputPath = new Map<string, DocumentationAsset>();
  const referencedAssets = new Set<string>();

  for (const guide of documentationConsumerGuideCatalog) {
    const pageSections = guide.sourceSlugs.map((sourceSlug) => {
      const sourcePage = readSourcePage(input.rawDocsRoot, sourceSlug);
      const sourceBody = stripReporterOwnedTitleHeading(
        sourcePage.body,
        sourcePage.title,
      );
      const headingViolations =
        generatedGuideLevelOneHeadingViolations(sourceBody);
      if (headingViolations.length > 0) {
        throw new Error(
          `Generated guide source ${sourceSlug} contains another level-one heading: ${headingViolations.join(', ')}`,
        );
      }
      copySourceAssets(
        sourceSlug,
        guide.slug,
        input.rawImagesRoot,
        assetsRoot,
        assetsByOutputPath,
      );
      const rewrittenBody = rewriteInternalDocumentationReferences(
        normalizeSourceHeadings(
          rewriteAssetReferences(sourceBody, sourceSlug, guide.slug),
        ),
      );
      for (const reference of collectLocalImageReferences(rewrittenBody)) {
        referencedAssets.add(reference);
      }
      return [`## ${sourcePage.title}`, '', rewrittenBody].join('\n');
    });
    const pageDirectory = path.join(contentRoot, guide.slug);
    fs.mkdirSync(pageDirectory, { recursive: true });
    const page = [
      `---`,
      `title: ${JSON.stringify(guide.title)}`,
      `---`,
      '',
      ...pageSections,
    ]
      .join('\n\n')
      .replace(/\n{3,}/gu, '\n\n');
    const languageViolations = generatedGuideLanguageViolations(page);
    if (languageViolations.length > 0) {
      throw new Error(
        `Generated guide ${guide.slug} contains implementation wording: ${languageViolations.join(', ')}`,
      );
    }
    fs.writeFileSync(path.join(pageDirectory, pageFileName), page);
  }

  assertExactSet(
    [...referencedAssets],
    [...assetsByOutputPath.keys()],
    'Generated documentation image references',
  );

  const assets = [...assetsByOutputPath.values()].sort((left, right) =>
    left.outputPath.localeCompare(right.outputPath),
  );
  const bundle: GeneratedDocumentationBundle = {
    assets,
    guides: documentationConsumerGuideCatalog.map((guide) => ({
      id: guide.id,
      metadata: {},
      sections: [],
      slug: guide.slug,
      title: guide.title,
    })),
    schemaVersion: bundleSchema,
  };
  writeJson(path.join(contentRoot, bundleFileName), bundle);

  const docs = [
    ...documentationConsumerGuideSlugs.map((slug) => `${slug}/${pageFileName}`),
    bundleFileName,
  ].sort((left, right) => left.localeCompare(right));
  const images = assets.map(({ outputPath }) => outputPath);
  const manifest = {
    contentHashes: {
      docs: Object.fromEntries(
        docs.map((relativePath) => [
          relativePath,
          fileHash(path.join(contentRoot, ...relativePath.split('/')), ':'),
        ]),
      ),
      images: Object.fromEntries(
        images.map((relativePath) => [
          relativePath,
          fileHash(path.join(assetsRoot, ...relativePath.split('/')), ':'),
        ]),
      ),
    },
    docs,
    images,
    schemaVersion: outputManifestSchema,
    targetFingerprints: {
      docs: outputRootFingerprint(contentRoot),
      images: outputRootFingerprint(assetsRoot),
    },
  };
  writeJson(path.join(contentRoot, manifestFileName), manifest);
};
