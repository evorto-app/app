const TEMPORARY_IMAGE_SOURCE_PATTERN =
  /<img\b[^>]*\bsrc\s*=\s*["']blob:[^"']+["'][^>]*>/i;

const USABLE_IMAGE_SOURCE_PATTERN =
  /<img\b[^>]*\bsrc\s*=\s*["']https?:\/\/[^"']+["'][^>]*>/i;

export const hasTemporaryRichTextImageSources = (content: string): boolean => {
  return TEMPORARY_IMAGE_SOURCE_PATTERN.test(content);
};

export const hasUsableRichTextImageSources = (content: string): boolean => {
  return USABLE_IMAGE_SOURCE_PATTERN.test(content);
};
