const leadingUppercasePattern = /([a-z0-9])([A-Z])/g;
const separatorPattern = /[_-]+/g;

const humanizeErrorTag = (tag: string): string => {
  const normalizedTag = tag
    .replace(/^Rpc/, '')
    .replace(/Error$/, '')
    .replaceAll(leadingUppercasePattern, '$1 $2')
    .replaceAll(separatorPattern, ' ')
    .trim();

  if (normalizedTag.length === 0) {
    return 'Unexpected error';
  }

  return normalizedTag[0].toUpperCase() + normalizedTag.slice(1);
};

export const getErrorMessage = (
  error: unknown,
  fallback = 'Unexpected error',
): string => {
  if (typeof error === 'string' && error.trim().length > 0) {
    return error;
  }

  if (error && typeof error === 'object') {
    const message = Reflect.get(error, 'message');
    if (typeof message === 'string' && message.trim().length > 0) {
      return message;
    }

    const tag = Reflect.get(error, '_tag');
    if (typeof tag === 'string' && tag.trim().length > 0) {
      return humanizeErrorTag(tag);
    }
  }

  return fallback;
};
