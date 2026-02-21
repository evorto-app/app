import * as RpcGroup from '@effect/rpc/RpcGroup';

import { EditorMediaCreateImageDirectUpload } from './definitions';

export class EditorMediaRpcs extends RpcGroup.make(
  EditorMediaCreateImageDirectUpload,
) {}
