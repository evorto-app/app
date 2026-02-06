import sanitizeHtml from 'sanitize-html';
import { hasUsableRichTextImageSources } from '@shared/utils/rich-text-media';

const ALLOWED_TAGS = [
  'a',
  'b',
  'blockquote',
  'br',
  'code',
  'em',
  'h1',
  'h2',
  'h3',
  'hr',
  'i',
  'img',
  'li',
  'ol',
  'p',
  'pre',
  'strong',
  'table',
  'tbody',
  'td',
  'th',
  'thead',
  'tr',
  'u',
  'ul',
] as const;

const ALLOWED_ATTRIBUTES: Record<string, string[]> = {
  a: ['href', 'rel', 'target', 'title'],
  img: ['alt', 'src', 'title'],
  td: ['colspan', 'rowspan'],
  th: ['colspan', 'rowspan'],
};

const ALLOWED_SCHEMES = ['http', 'https', 'mailto'];

const STRUCTURAL_MEDIA_NODE_PATTERN = /<(table|hr)\b/i;

export const sanitizeRichTextHtml = (content: string): string => {
  return sanitizeHtml(content, {
    allowedAttributes: ALLOWED_ATTRIBUTES,
    allowedSchemes: ALLOWED_SCHEMES,
    allowedTags: [...ALLOWED_TAGS],
    enforceHtmlBoundary: true,
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', {
        rel: 'noopener noreferrer nofollow',
        target: '_blank',
      }),
    },
  });
};

export const sanitizeOptionalRichTextHtml = (
  content: null | string | undefined,
): null | string => {
  if (!content?.trim()) {
    return null;
  }

  const sanitized = sanitizeRichTextHtml(content);

  if (!isMeaningfulRichTextHtml(sanitized)) {
    return null;
  }

  return sanitized;
};

export const isMeaningfulRichTextHtml = (content: string): boolean => {
  const plainText = sanitizeHtml(content, {
    allowedAttributes: {},
    allowedTags: [],
  })
    .replaceAll(/\u00A0/g, ' ')
    .trim();

  if (plainText.length > 0) {
    return true;
  }

  if (STRUCTURAL_MEDIA_NODE_PATTERN.test(content)) {
    return true;
  }

  return hasUsableRichTextImageSources(content);
};
