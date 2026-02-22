 

import type { Headers } from '@effect/platform';

import { Effect, Schema } from 'effect';

import type { AppRpcHandlers } from '../shared/handler-types';

import { Tenant } from '../../../../../types/custom/tenant';
import { User } from '../../../../../types/custom/user';
import { createCloudflareImageDirectUpload } from '../../../../integrations/cloudflare-images';
import {
  decodeRpcContextHeaderJson,
  RPC_CONTEXT_HEADERS,
} from '../../rpc-context-headers';

const ALLOWED_IMAGE_MIME_TYPES = [
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;
const ALLOWED_IMAGE_MIME_TYPE_SET = new Set<string>(ALLOWED_IMAGE_MIME_TYPES);
const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;

const decodeHeaderJson = <A, I>(
  value: string | undefined,
  schema: Schema.Schema<A, I, never>,
) => Schema.decodeUnknownSync(schema)(decodeRpcContextHeaderJson(value));

const ensureAuthenticated = (
  headers: Headers.Headers,
): Effect.Effect<void, 'UNAUTHORIZED'> =>
  headers[RPC_CONTEXT_HEADERS.AUTHENTICATED] === 'true'
    ? Effect.void
    : Effect.fail('UNAUTHORIZED' as const);

const decodeUserHeader = (headers: Headers.Headers) =>
  Effect.sync(() =>
    decodeHeaderJson(headers[RPC_CONTEXT_HEADERS.USER], Schema.NullOr(User)),
  );

const requireUserHeader = (
  headers: Headers.Headers,
): Effect.Effect<User, 'UNAUTHORIZED'> =>
  Effect.gen(function* () {
    const user = yield* decodeUserHeader(headers);
    if (!user) {
      return yield* Effect.fail('UNAUTHORIZED' as const);
    }
    return user;
  });

export const editorMediaHandlers = {
    'editorMedia.createImageDirectUpload': (input, options) =>
      Effect.gen(function* () {
        yield* ensureAuthenticated(options.headers);
        const tenant = decodeHeaderJson(
          options.headers[RPC_CONTEXT_HEADERS.TENANT],
          Tenant,
        );
        const user = yield* requireUserHeader(options.headers);

        if (!ALLOWED_IMAGE_MIME_TYPE_SET.has(input.mimeType)) {
          return yield* Effect.fail('BAD_REQUEST' as const);
        }

        if (
          input.fileSizeBytes <= 0 ||
          input.fileSizeBytes > MAX_IMAGE_SIZE_BYTES
        ) {
          return yield* Effect.fail('BAD_REQUEST' as const);
        }

        return yield* Effect.tryPromise({
          catch: () => 'INTERNAL_SERVER_ERROR' as const,
          try: () =>
            createCloudflareImageDirectUpload({
              fileName: input.fileName,
              mimeType: input.mimeType,
              source: 'editor',
              tenantId: tenant.id,
              uploadedByUserId: user.id,
            }),
        });
      }),
} satisfies Partial<AppRpcHandlers>;
