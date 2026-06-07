import type { TestCase, TestResult } from '@playwright/test/reporter';
import * as crypto from 'node:crypto';
import path from 'node:path';
import { PNG } from 'pngjs';

import { DOCUMENTATION_ATTACHMENT_NAMES, writeFile } from './shared';

export type ResultAttachment = TestResult['attachments'][number];
const highlightedTargetColor = { b: 153, g: 72, r: 236 };
const minimumHighlightedPixelCount = 16;
const minimumVisibleContentPixelCount = 128;
const minimumCaptionLength = 32;
const minimumCaptionWordCount = 5;
const minimumImageWidth = 320;
const minimumImageHeight = 240;
const minimumMarkdownBodyLength = 120;
const rawMarkdownImagePattern =
  /!\[[^\]]*\](?:\([^)]+\)|\[[^\]]*\])?|<(?:img|picture|source|svg|image|object|embed|iframe|video|canvas)(?:\s|>|\/)|style\s*=\s*(?:"[^"]*url\s*\(|'[^']*url\s*\(|[^\s>]*url\s*\()|(?:background(?:-image)?|list-style(?:-image)?|border-image(?:-source)?|content|(?:-webkit-)?mask(?:-image|-box-image)?|cursor)\s*:\s*[^;{}]*?\burl\s*\(/iu;
const imageContentTypePattern = /^image\//iu;

export const assertNoUnsupportedDocumentationImageAttachments = (
  attachments: ResultAttachment[],
  testTitle: string,
): void => {
  const unsupportedImageAttachment = attachments.find(
    (attachment) =>
      !DOCUMENTATION_ATTACHMENT_NAMES.has(attachment.name) &&
      imageContentTypePattern.test(attachment.contentType),
  );

  if (!unsupportedImageAttachment) {
    return;
  }

  throw new Error(
    `Documentation image attachment "${unsupportedImageAttachment.name}" in ${testTitle} uses unsupported content type ${unsupportedImageAttachment.contentType}. Use the shared screenshot helper so image evidence is captioned, highlighted, and validated.`,
  );
};

const readAttachmentBody = (
  attachment: ResultAttachment,
  testTitle: string,
  label: string,
): Buffer | undefined => {
  if (!attachment.body) {
    console.warn(`Missing body for ${label} in ${testTitle}`);
    return undefined;
  }
  return attachment.body;
};

const parseMarkdownAttachment = (markdown: string) => {
  const fmMatch = markdown.match(/^---[\s\S]*?---\s*/);
  if (!fmMatch)
    return { body: markdown, frontMatterPermissions: [] as string[] };

  const frontMatterPermissions = fmMatch[0]
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*-\s*(.+)$/)?.[1])
    .filter((line): line is string => Boolean(line));

  return {
    body: markdown.slice(fmMatch[0].length),
    frontMatterPermissions,
  };
};

const collectPermissionsLines = (
  attachments: ResultAttachment[],
  testTitle: string,
): string[] => {
  const permissionsAttachment = attachments.find(
    (attachment) => attachment.name === 'permissions',
  );
  const body = permissionsAttachment
    ? readAttachmentBody(permissionsAttachment, testTitle, 'permissions')
    : undefined;
  if (!body) return [];
  return body
    .toString()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
};

const appendPermissionsCallout = (
  sectionContent: string[],
  permissionsLines: string[],
) => {
  if (!permissionsLines.length) return;
  sectionContent.push(
    '{% callout type="note" title="User permissions" %}',
    ...permissionsLines.map((permission) => `- ${permission}`),
    '{% /callout %}',
    '',
  );
};

const escapeAttribute = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');

const assertMeaningfulDocumentationImage = (
  attachment: ResultAttachment,
  body: Buffer,
  testTitle: string,
): void => {
  if (attachment.contentType !== 'image/png') {
    throw new Error(
      `Documentation image attachment in ${testTitle} must be image/png so generated docs can verify screenshot evidence quality.`,
    );
  }

  let png: PNG;

  try {
    png = PNG.sync.read(body);
  } catch {
    throw new Error(
      `Documentation image attachment in ${testTitle} must be a valid PNG screenshot.`,
    );
  }

  if (png.width < minimumImageWidth || png.height < minimumImageHeight) {
    throw new Error(
      `Documentation image attachment in ${testTitle} must be at least ${minimumImageWidth}x${minimumImageHeight}px so generated docs show enough UI context to judge the captured state.`,
    );
  }

  let highlightedPixels = 0;
  let contentPixels = 0;

  for (let offset = 0; offset < png.data.length; offset += 4) {
    const r = png.data[offset];
    const g = png.data[offset + 1];
    const b = png.data[offset + 2];
    const a = png.data[offset + 3];
    const isHighlight =
      r === highlightedTargetColor.r &&
      g === highlightedTargetColor.g &&
      b === highlightedTargetColor.b;
    const isNearWhite = r >= 248 && g >= 248 && b >= 248;

    if (a > 0 && isHighlight) {
      highlightedPixels += 1;
    }

    if (a > 0 && !isHighlight && !isNearWhite) {
      contentPixels += 1;
    }
  }

  if (highlightedPixels < minimumHighlightedPixelCount) {
    throw new Error(
      `Documentation image attachment in ${testTitle} must include the highlighted focus target.`,
    );
  }

  if (contentPixels < minimumVisibleContentPixelCount) {
    throw new Error(
      `Documentation image attachment in ${testTitle} must include visible page content outside the highlighted focus target.`,
    );
  }
};

const assertDescriptiveDocumentationCaption = (
  caption: string,
  testTitle: string,
): void => {
  const trimmedCaption = caption.trim();
  const captionWords = trimmedCaption.split(/\s+/u).filter(Boolean);

  if (
    trimmedCaption.length < minimumCaptionLength ||
    captionWords.length < minimumCaptionWordCount
  ) {
    throw new Error(
      `Documentation image-caption attachment in ${testTitle} must be a descriptive caption of at least 32 characters and five words.`,
    );
  }
};

const assertNoRawMarkdownImages = (
  markdown: string,
  testTitle: string,
): void => {
  if (rawMarkdownImagePattern.test(markdown)) {
    throw new Error(
      `Documentation markdown attachment in ${testTitle} must not include raw Markdown image syntax, including reference-style images, raw HTML visual/media tags, or raw CSS image URLs. Use the shared screenshot helper so captions, highlights, and content checks stay enforced.`,
    );
  }
};

const assertDescriptiveMarkdownBody = (
  markdownBody: string,
  testTitle: string,
): void => {
  const normalizedBody = markdownBody.replace(/\s+/gu, ' ').trim();

  if (normalizedBody.length < minimumMarkdownBodyLength) {
    throw new Error(
      `Documentation markdown attachment in ${testTitle} must include at least ${minimumMarkdownBodyLength} characters of explanatory body text so generated docs can be judged without clicking through the app.`,
    );
  }
};

export const buildSectionContent = (
  test: TestCase,
  attachments: ResultAttachment[],
  folderName: string,
  picturesFolder: string,
): string[] => {
  const sectionContent: string[] = [];
  const permissionsLines = collectPermissionsLines(attachments, test.title);

  for (const attachment of attachments) {
    switch (attachment.name) {
      case 'image': {
        const body = readAttachmentBody(attachment, test.title, 'image');
        if (!body) continue;
        assertMeaningfulDocumentationImage(attachment, body, test.title);

        const hash = crypto.createHash('sha256').update(body).digest('hex');
        const id = hash.slice(0, 16);
        const ext = attachment.contentType.split('/')[1] || 'png';
        const imageName = `${attachment.name}-${id}.${ext}`;
        writeFile(path.join(picturesFolder, imageName), body);
        sectionContent.push(
          `![${attachment.name}](${folderName}/${imageName})`,
        );
        break;
      }
      case 'image-caption': {
        const body = readAttachmentBody(
          attachment,
          test.title,
          'image-caption',
        );
        if (!body) continue;

        const last = sectionContent.at(-1) ?? '';
        if (!last.startsWith('![')) {
          throw new Error(
            `Documentation image-caption attachment in ${test.title} is missing a preceding image attachment.`,
          );
        }
        assertDescriptiveDocumentationCaption(body.toString(), test.title);
        const imageUrl = last.split('(')[1]?.split(')')[0] ?? '';
        sectionContent[sectionContent.length - 1] =
          `{% figure src="${escapeAttribute(imageUrl)}" caption="${escapeAttribute(body.toString())}" /%}`;
        break;
      }
      case 'markdown': {
        const body = readAttachmentBody(attachment, test.title, 'markdown');
        if (!body) continue;

        const markdown = body.toString();
        assertNoRawMarkdownImages(markdown, test.title);
        const parsedMarkdown = parseMarkdownAttachment(markdown);
        assertDescriptiveMarkdownBody(parsedMarkdown.body, test.title);
        permissionsLines.push(...parsedMarkdown.frontMatterPermissions);
        appendPermissionsCallout(sectionContent, permissionsLines);
        sectionContent.push(parsedMarkdown.body.trim());
        break;
      }
      case 'permissions': {
        break;
      }
    }
  }

  const uncaptionedImage = sectionContent.find((line) => line.startsWith('!['));
  if (uncaptionedImage) {
    throw new Error(
      `Documentation image attachment in ${test.title} is missing a paired image-caption attachment.`,
    );
  }

  return sectionContent;
};
