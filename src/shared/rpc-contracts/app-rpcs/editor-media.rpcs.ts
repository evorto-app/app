import * as Rpc from '@effect/rpc/Rpc';
import * as RpcGroup from '@effect/rpc/RpcGroup';
import { asRpcMutation } from '@heddendorp/effect-angular-query';
import { Schema } from 'effect';

export const EditorMediaRpcError = Schema.Literal(
  'BAD_REQUEST',
  'INTERNAL_SERVER_ERROR',
  'UNAUTHORIZED',
);

export type EditorMediaRpcError = Schema.Schema.Type<
  typeof EditorMediaRpcError
>;

export const EditorMediaCreateImageDirectUpload = asRpcMutation(
  Rpc.make('editorMedia.createImageDirectUpload', {
    error: EditorMediaRpcError,
    payload: Schema.Struct({
      fileName: Schema.NonEmptyString,
      fileSizeBytes: Schema.Number.pipe(Schema.nonNegative()),
      mimeType: Schema.NonEmptyString,
    }),
    success: Schema.Struct({
      deliveryUrl: Schema.NonEmptyString,
      imageId: Schema.NonEmptyString,
      uploadUrl: Schema.NonEmptyString,
    }),
  }),
);

export class EditorMediaRpcs extends RpcGroup.make(
  EditorMediaCreateImageDirectUpload,
) {}
