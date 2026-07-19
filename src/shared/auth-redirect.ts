const redirectBaseUrl = new URL('https://redirect.invalid');
const hasUnsafeRedirectCharacter = (value: string): boolean =>
  [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return (
      character === '\\' ||
      codePoint === undefined ||
      codePoint <= 0x1f ||
      codePoint === 0x7f
    );
  });
const isSafeRelativeRedirectPath = (value: string): boolean =>
  value.startsWith('/') &&
  !value.startsWith('//') &&
  !value.includes('://') &&
  !hasUnsafeRedirectCharacter(value);

export const sanitizeRelativeRedirectPath = (
  value: null | string | undefined,
): string | undefined => {
  if (!value || !isSafeRelativeRedirectPath(value)) {
    return;
  }

  try {
    const parsed = new URL(value, redirectBaseUrl);
    if (parsed.origin !== redirectBaseUrl.origin) {
      return;
    }

    const canonicalPath = `${parsed.pathname}${parsed.search}`;
    return isSafeRelativeRedirectPath(canonicalPath)
      ? canonicalPath
      : undefined;
  } catch {
    return;
  }
};

export const relativeRedirectPathFromRequest = (
  request: Pick<Request, 'url'>,
): string => {
  try {
    const requestUrl = new URL(request.url);
    if (requestUrl.protocol !== 'http:' && requestUrl.protocol !== 'https:') {
      return '/';
    }

    return (
      sanitizeRelativeRedirectPath(
        `${requestUrl.pathname}${requestUrl.search}`,
      ) ?? '/'
    );
  } catch {
    return '/';
  }
};

export const forwardLoginPath = (redirectPath: string): string => {
  const parameters = new URLSearchParams({
    redirectUrl: sanitizeRelativeRedirectPath(redirectPath) ?? '/',
  });
  return `/forward-login?${parameters.toString()}`;
};
