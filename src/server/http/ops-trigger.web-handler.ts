import { Effect, Schema } from 'effect';

import { type OpsCommandError } from '../ops/schema-operations';
import { handleInternalJsonTriggerWebRequest } from './internal-trigger.web-handler';

const noStoreHeaders = {
  'Cache-Control': 'no-store',
};

export const handleOpsJsonTriggerWebRequest = <
  S extends Schema.Constraint,
  A,
  R,
>(
  request: Request,
  schema: S,
  operation: (arguments_: S['Type']) => Effect.Effect<A, OpsCommandError, R>,
) =>
  handleInternalJsonTriggerWebRequest(request, schema, operation).pipe(
    Effect.catchTag('OpsCommandError', (error) =>
      Effect.succeed(
        Response.json(
          {
            detail: error.diagnostic,
            error: 'ops-command-failed',
          },
          { headers: noStoreHeaders, status: 500 },
        ),
      ),
    ),
  );
