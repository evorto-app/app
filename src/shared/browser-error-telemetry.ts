export const MAX_BROWSER_ERROR_TELEMETRY_BODY_SIZE_BYTES = 8 * 1024;

export interface BrowserErrorTelemetryPayload {
  readonly message: string;
  readonly name: string;
  readonly stack: null | string;
  readonly url: null | string;
}

const fieldCharacterLimits = {
  message: 2000,
  name: 200,
  stack: 4000,
  url: 1000,
} as const;
const oversizedFieldRedaction = '[REDACTED_OVERSIZED_FIELD]';

const redactTransferPathCredentials = (value: string): string =>
  value.replaceAll(
    /(^|[\s"'(<=>])((?:https?:\/\/[^\s/?#]+)?)(\/[^\s?#"'<>]*)/giu,
    (_match: string, boundary: string, origin: string, pathname: string) => {
      // Angular accepts primary routes inside outlet groups as well as /paths.
      const safePath = pathname.replaceAll(
        /(^\/|\(|\/\/)(primary:)?([^/;():]+)(;[^/()]*)?\/([^/()]+)/gu,
        (
          match: string,
          prefix: string,
          outlet: string | undefined,
          route: string,
          parameters: string | undefined,
        ) => {
          let routeName: string;
          try {
            routeName = decodeURIComponent(route);
          } catch {
            return match;
          }
          return routeName.toLowerCase() === 'registration-transfers'
            ? `${prefix}${outlet ?? ''}${route}${parameters ?? ''}/[REDACTED_TOKEN]`
            : match;
        },
      );
      return `${boundary}${origin}${safePath}`;
    },
  );

const redactPatterns = (value: string): string =>
  redactTransferPathCredentials(value)
    .replaceAll(/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/\\?#]*@/giu, '$1')
    .replaceAll(/(bearer\s+)[a-z0-9._~+/=-]+/giu, '$1[REDACTED]')
    .replaceAll(
      /\b(?:[0-9a-f]{4}-){7}[0-9a-f]{4}\b/giu,
      '[REDACTED_CLAIM_CODE]',
    )
    .replaceAll(
      /\b[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}\b/giu,
      '[REDACTED_TOKEN]',
    )
    .replaceAll(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/giu,
      '[REDACTED_ID]',
    )
    .replaceAll(/\bauth0\|[a-z0-9_-]+\b/giu, '[REDACTED_ID]')
    .replaceAll(
      /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu,
      '[REDACTED_EMAIL]',
    );

const sanitizeText = (value: string, maxCharacters: number): string =>
  value.length > maxCharacters
    ? oversizedFieldRedaction
    : redactPatterns(value).slice(0, maxCharacters);

const sanitizeUrl = (value: null | string): null | string => {
  if (value === null || value.length > fieldCharacterLimits.url) {
    return null;
  }

  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    url.hash = '';
    url.search = '';
    const normalized = url.href;
    // Percent-encoded paths can expand even when the raw URL is short.
    return normalized.length > fieldCharacterLimits.url
      ? null
      : redactPatterns(normalized).slice(0, fieldCharacterLimits.url);
  } catch {
    return null;
  }
};

export const sanitizeBrowserErrorTelemetryPayload = (
  payload: BrowserErrorTelemetryPayload,
): BrowserErrorTelemetryPayload => ({
  message: sanitizeText(payload.message, fieldCharacterLimits.message),
  name: sanitizeText(payload.name, fieldCharacterLimits.name),
  stack:
    payload.stack === null
      ? null
      : sanitizeText(payload.stack, fieldCharacterLimits.stack),
  url: sanitizeUrl(payload.url),
});

const jsonFieldByteLimits = {
  message: 2048,
  name: 256,
  stack: 4096,
  url: 1024,
} as const;
const textEncoder = new TextEncoder();

const jsonByteLength = (value: string) => textEncoder.encode(value).byteLength;

const boundJsonString = (value: string, maxBytes: number): string => {
  const encoded = JSON.stringify(value);
  if (jsonByteLength(encoded) <= maxBytes) {
    return value;
  }

  const characters: string[] = [];
  let encodedBytes = 2;
  for (const character of value) {
    const encodedCharacter = JSON.stringify(character).slice(1, -1);
    const nextEncodedBytes = encodedBytes + jsonByteLength(encodedCharacter);
    if (nextEncodedBytes > maxBytes) {
      break;
    }
    characters.push(character);
    encodedBytes = nextEncodedBytes;
  }

  return characters.join('');
};

export const serializeBrowserErrorTelemetryPayload = (
  payload: BrowserErrorTelemetryPayload,
): string => {
  const sanitized = sanitizeBrowserErrorTelemetryPayload(payload);
  return JSON.stringify({
    message: boundJsonString(sanitized.message, jsonFieldByteLimits.message),
    name: boundJsonString(sanitized.name, jsonFieldByteLimits.name),
    stack:
      sanitized.stack === null
        ? null
        : boundJsonString(sanitized.stack, jsonFieldByteLimits.stack),
    url:
      sanitized.url === null
        ? null
        : boundJsonString(sanitized.url, jsonFieldByteLimits.url),
  });
};
