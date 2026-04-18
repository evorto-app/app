import * as HttpServerResponse from '@effect/platform/HttpServerResponse';

const SECURITY_HEADERS = {
  'Permissions-Policy': 'camera=(), geolocation=(), microphone=()',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
} as const;

export const applySecurityHeaders = (
  response: HttpServerResponse.HttpServerResponse,
): HttpServerResponse.HttpServerResponse =>
  HttpServerResponse.setHeaders(response, SECURITY_HEADERS);
