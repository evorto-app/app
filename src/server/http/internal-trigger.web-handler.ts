import { Effect, Option, Schema } from 'effect';

import { readRequestBody } from './request-body';

export const MAX_INTERNAL_TRIGGER_BODY_SIZE_BYTES = 4 * 1024;

const noStoreHeaders = {
  'Cache-Control': 'no-store',
};

export const InternalTriggerArguments = Schema.Struct({
  limit: Schema.optional(
    Schema.Int.check(Schema.isBetween({ maximum: 100, minimum: 1 })),
  ),
});

export type InternalTriggerArguments = Schema.Schema.Type<
  typeof InternalTriggerArguments
>;

const decodeArguments = <S extends Schema.Constraint>(
  request: Request,
  schema: S,
) =>
  readRequestBody(request, MAX_INTERNAL_TRIGGER_BODY_SIZE_BYTES).pipe(
    Effect.flatMap((body) =>
      Effect.try(() => JSON.parse(new TextDecoder().decode(body))),
    ),
    Effect.flatMap((value) =>
      Schema.decodeUnknownEffect(schema)(value, {
        onExcessProperty: 'error',
      }),
    ),
    Effect.option,
  );

export const handleInternalJsonTriggerWebRequest = <
  S extends Schema.Constraint,
  A,
  E,
  R,
>(
  request: Request,
  schema: S,
  operation: (arguments_: S['Type']) => Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    if (
      request.headers
        .get('content-type')
        ?.split(';', 1)[0]
        ?.trim()
        .toLowerCase() !== 'application/json'
    ) {
      return new Response(null, { headers: noStoreHeaders, status: 415 });
    }

    const argumentsOption = yield* decodeArguments(request, schema);
    if (Option.isNone(argumentsOption)) {
      return new Response(null, { headers: noStoreHeaders, status: 400 });
    }

    const result = yield* operation(argumentsOption.value);
    return Response.json(result, { headers: noStoreHeaders });
  });

export const handleInternalTriggerWebRequest = <A, E, R>(
  request: Request,
  operation: (arguments_: InternalTriggerArguments) => Effect.Effect<A, E, R>,
): Effect.Effect<Response, E, R> =>
  handleInternalJsonTriggerWebRequest(
    request,
    InternalTriggerArguments,
    operation,
  );
