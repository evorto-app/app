const unsafeErrorTagPattern = /(Forbidden|Internal|Unauthorized).*Error$/;

export const getErrorMessage = (
  error: unknown,
  fallback = 'Something went wrong. Try again.',
  expectedTags: readonly string[] = [],
): string => {
  if (
    typeof error !== 'object' ||
    error === null ||
    !('_tag' in error) ||
    !('message' in error) ||
    typeof error._tag !== 'string' ||
    typeof error.message !== 'string' ||
    error.message.trim().length === 0
  ) {
    return fallback;
  }

  if (
    error instanceof Error &&
    Object.getPrototypeOf(error) === Error.prototype
  ) {
    return fallback;
  }

  if (unsafeErrorTagPattern.test(error._tag)) {
    return fallback;
  }

  return expectedTags.includes(error._tag) ? error.message : fallback;
};
