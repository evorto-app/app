export const MAX_BROWSER_ERROR_TELEMETRY_BODY_SIZE_BYTES = 8 * 1024;

export interface BrowserErrorTelemetryPayload {
  readonly message: string;
  readonly name: string;
  readonly stack: null | string;
  readonly url: null | string;
}

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
): string =>
  JSON.stringify({
    message: boundJsonString(payload.message, jsonFieldByteLimits.message),
    name: boundJsonString(payload.name, jsonFieldByteLimits.name),
    stack:
      payload.stack === null
        ? null
        : boundJsonString(payload.stack, jsonFieldByteLimits.stack),
    url:
      payload.url === null
        ? null
        : boundJsonString(payload.url, jsonFieldByteLimits.url),
  });
