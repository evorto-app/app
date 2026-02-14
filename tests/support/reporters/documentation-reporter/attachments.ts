import type { TestCase, TestResult } from '@playwright/test/reporter';
import * as crypto from 'node:crypto';
import path from 'node:path';

import { writeFile } from './shared';

export type ResultAttachment = TestResult['attachments'][number];

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
        if (!last.startsWith('![')) break;
        const imageUrl = last.split('(')[1]?.split(')')[0] ?? '';
        sectionContent[sectionContent.length - 1] =
          `{% figure src="${imageUrl}" caption="${body.toString()}" /%}`;
        break;
      }
      case 'markdown': {
        const body = readAttachmentBody(attachment, test.title, 'markdown');
        if (!body) continue;

        const parsedMarkdown = parseMarkdownAttachment(body.toString());
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

  return sectionContent;
};
