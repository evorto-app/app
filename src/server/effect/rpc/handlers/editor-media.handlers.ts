import type { Headers } from '@effect/platform';

import {
  RpcBadRequestError,
  RpcUnauthorizedError,
} from '@shared/errors/rpc-errors';
import { Effect, Schema } from 'effect';

import type { AppRpcHandlers } from './shared/handler-types';

import { Tenant } from '../../../../types/custom/tenant';
import { User } from '../../../../types/custom/user';
import { createCloudflareImageDirectUpload } from '../../../integrations/cloudflare-images';
import {
  decodeRpcContextHeaderJson,
  RPC_CONTEXT_HEADERS,
} from '../rpc-context-headers';

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
): Effect.Effect<void, RpcUnauthorizedError> =>
  headers[RPC_CONTEXT_HEADERS.AUTHENTICATED] === 'true'
    ? Effect.void
    : Effect.fail(new RpcUnauthorizedError({ message: 'Authentication required' }));

const decodeUserHeader = (headers: Headers.Headers) =>
  Effect.sync(() =>
    decodeHeaderJson(headers[RPC_CONTEXT_HEADERS.USER], Schema.NullOr(User)),
  );

const requireUserHeader = (
  headers: Headers.Headers,
): Effect.Effect<User, RpcUnauthorizedError> =>
  Effect.gen(function* () {
    const user = yield* decodeUserHeader(headers);
    if (!user) {
      return yield* Effect.fail(new RpcUnauthorizedError({ message: 'Authentication required' }));
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
          return yield* Effect.fail(new RpcBadRequestError({ message: 'Bad request' }));
        }

        if (
          input.fileSizeBytes <= 0 ||
          input.fileSizeBytes > MAX_IMAGE_SIZE_BYTES
        ) {
          return yield* Effect.fail(new RpcBadRequestError({ message: 'Bad request' }));
        }

        return yield* createCloudflareImageDirectUpload({
          fileName: input.fileName,
          mimeType: input.mimeType,
          source: 'editor',
          tenantId: tenant.id,
          uploadedByUserId: user.id,
        }).pipe(
          Effect.tapError((error) =>
            Effect.logError('Cloudflare image direct upload initialization failed').pipe(
              Effect.annotateLogs({
                error: error instanceof Error ? error.message : String(error),
                tenantId: tenant.id,
                userId: user.id,
              }),
            ),
          ),
        );
      }),
} satisfies Partial<AppRpcHandlers>;
