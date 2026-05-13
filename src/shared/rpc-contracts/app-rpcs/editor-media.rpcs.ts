import { asRpcMutation } from '@heddendorp/effect-angular-query';
import { nonNegativeNumber } from '@shared/schema-utilities';
import { Schema } from 'effect';
import * as Rpc from 'effect/unstable/rpc/Rpc';
import * as RpcGroup from 'effect/unstable/rpc/RpcGroup';

import { BadRequestInternalUnauthorizedRpcError } from '../../errors/rpc-errors';

export const EditorMediaRpcError = BadRequestInternalUnauthorizedRpcError;

export type EditorMediaRpcError = BadRequestInternalUnauthorizedRpcError;

export const EditorMediaCreateImageDirectUpload = asRpcMutation(
  Rpc.make('editorMedia.createImageDirectUpload', {
    error: EditorMediaRpcError,
    payload: Schema.Struct({
      fileName: Schema.NonEmptyString,
      fileSizeBytes: nonNegativeNumber,
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
