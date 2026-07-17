import {
  ConfigProvider,
  Context,
  Effect,
  Layer,
  Option,
  Redacted,
  Schema,
} from 'effect';

import {
  emailDeliveryConfigState,
  validateEmailDeliveryConfig,
} from '../config/email-delivery-config';

export const TRANSACTIONAL_EMAIL_SENDER = {
  email: 'no-reply@notifications.evorto.app',
  name: 'Evorto',
} as const;

export type EmailDeliveryError =
  | EmailDeliveryPermanentError
  | EmailDeliveryRetryableError
  | EmailDeliveryUnknownError;

export type EmailDeliveryProvider = 'fake' | 'mailpit' | 'tem';

export interface EmailDeliveryRequest {
  readonly html: string;
  readonly idempotencyKey: string;
  readonly replyTo: null | {
    readonly email: string;
    readonly name: string;
  };
  readonly subject: string;
  readonly text: string;
  readonly to: string;
}

export type EmailDeliveryResult =
  | {
      readonly _tag: 'Delivered';
      readonly provider: EmailDeliveryProvider;
      readonly providerMessageId: string;
    }
  | {
      readonly _tag: 'Suppressed';
      readonly provider: EmailDeliveryProvider;
      readonly reason: string;
    };

interface EmailDeliveryShape {
  readonly deliver: (
    request: EmailDeliveryRequest,
  ) => Effect.Effect<EmailDeliveryResult, EmailDeliveryError>;
}

const EmailDeliveryProviderSchema = Schema.Literals(['fake', 'mailpit', 'tem']);

export class EmailDeliveryPermanentError extends Schema.TaggedErrorClass<EmailDeliveryPermanentError>()(
  'EmailDeliveryPermanentError',
  {
    message: Schema.String,
    provider: EmailDeliveryProviderSchema,
  },
) {}

export class EmailDeliveryRetryableError extends Schema.TaggedErrorClass<EmailDeliveryRetryableError>()(
  'EmailDeliveryRetryableError',
  {
    message: Schema.String,
    provider: EmailDeliveryProviderSchema,
  },
) {}

export class EmailDeliveryUnknownError extends Schema.TaggedErrorClass<EmailDeliveryUnknownError>()(
  'EmailDeliveryUnknownError',
  {
    cause: Schema.optional(Schema.Defect()),
    message: Schema.String,
    provider: EmailDeliveryProviderSchema,
  },
) {}

const TemCreateEmailResponse = Schema.Struct({
  emails: Schema.Array(
    Schema.Struct({
      id: Schema.NonEmptyString,
    }),
  ),
});

const MailpitSendMessageResponse = Schema.Struct({
  ID: Schema.NonEmptyString,
});

const errorMessageFromUnknown = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const isRetryableStatus = (status: number): boolean =>
  status === 408 || status === 425 || status === 429 || status >= 500;

const requestFailure = (
  provider: EmailDeliveryProvider,
  response: Response,
): EmailDeliveryPermanentError | EmailDeliveryRetryableError => {
  const fields = {
    message: `${provider} email request failed with HTTP ${response.status}`,
    provider,
  };
  return isRetryableStatus(response.status)
    ? new EmailDeliveryRetryableError(fields)
    : new EmailDeliveryPermanentError(fields);
};

const postJson = Effect.fn('EmailDelivery.postJson')(function* (
  provider: EmailDeliveryProvider,
  url: string | URL,
  body: unknown,
  headers: Readonly<Record<string, string>>,
) {
  return yield* Effect.tryPromise({
    catch: (cause) =>
      new EmailDeliveryUnknownError({
        cause,
        message: `${provider} delivery outcome is unknown: ${errorMessageFromUnknown(cause)}`,
        provider,
      }),
    try: (signal) =>
      fetch(url, {
        body: JSON.stringify(body),
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        method: 'POST',
        signal,
      }),
  });
});

const parseJsonResponse = Effect.fn('EmailDelivery.parseJsonResponse')(
  function* <S extends Schema.Constraint>(
    provider: EmailDeliveryProvider,
    response: Response,
    schema: S,
  ) {
    const body = yield* Effect.tryPromise({
      catch: (cause) =>
        new EmailDeliveryUnknownError({
          cause,
          message: `${provider} accepted the request but returned an unreadable response`,
          provider,
        }),
      try: () => response.json(),
    });
    return yield* Schema.decodeUnknownEffect(schema)(body).pipe(
      Effect.mapError(
        (cause) =>
          new EmailDeliveryUnknownError({
            cause,
            message: `${provider} accepted the request but omitted its message identifier`,
            provider,
          }),
      ),
    );
  },
);

const makeTemDeliver = (config: {
  projectId: string;
  token: Redacted.Redacted;
}) =>
  Effect.fn('EmailDelivery.tem')(function* (request: EmailDeliveryRequest) {
    const provider = 'tem' as const;
    const response = yield* postJson(
      provider,
      'https://api.scaleway.com/transactional-email/v1alpha1/regions/fr-par/emails',
      {
        additional_headers: [
          ...(request.replyTo
            ? [
                {
                  key: 'Reply-To',
                  value: `${request.replyTo.name.replaceAll('"', '').trim()} <${request.replyTo.email}>`,
                },
              ]
            : []),
          {
            key: 'X-Evorto-Idempotency-Key',
            value: request.idempotencyKey,
          },
        ],
        from: TRANSACTIONAL_EMAIL_SENDER,
        html: request.html,
        project_id: config.projectId,
        subject: request.subject,
        text: request.text,
        to: [{ email: request.to }],
      },
      { 'X-Auth-Token': Redacted.value(config.token) },
    );
    if (!response.ok) {
      return yield* Effect.fail(requestFailure(provider, response));
    }
    const body = yield* parseJsonResponse(
      provider,
      response,
      TemCreateEmailResponse,
    );
    const email = body.emails[0];
    if (!email) {
      return yield* Effect.fail(
        new EmailDeliveryUnknownError({
          message: 'tem accepted the request but returned no email record',
          provider,
        }),
      );
    }
    return {
      _tag: 'Delivered' as const,
      provider,
      providerMessageId: email.id,
    };
  });

const makeMailpitDeliver = (apiUrl: URL) =>
  Effect.fn('EmailDelivery.mailpit')(function* (request: EmailDeliveryRequest) {
    const provider = 'mailpit' as const;
    const response = yield* postJson(
      provider,
      apiUrl,
      {
        From: {
          Email: TRANSACTIONAL_EMAIL_SENDER.email,
          Name: TRANSACTIONAL_EMAIL_SENDER.name,
        },
        Headers: { 'X-Evorto-Idempotency-Key': request.idempotencyKey },
        HTML: request.html,
        ...(request.replyTo && {
          ReplyTo: [
            { Email: request.replyTo.email, Name: request.replyTo.name },
          ],
        }),
        Subject: request.subject,
        Text: request.text,
        To: [{ Email: request.to }],
      },
      {},
    );
    if (!response.ok) {
      return yield* Effect.fail(requestFailure(provider, response));
    }
    const body = yield* parseJsonResponse(
      provider,
      response,
      MailpitSendMessageResponse,
    );
    return {
      _tag: 'Delivered' as const,
      provider,
      providerMessageId: body.ID,
    };
  });

export class EmailDelivery extends Context.Service<
  EmailDelivery,
  EmailDeliveryShape
>()('@server/integrations/EmailDelivery', {
  make: Effect.gen(function* () {
    const configProvider = yield* ConfigProvider.ConfigProvider;
    const state = yield* emailDeliveryConfigState.pipe(
      Effect.provideService(ConfigProvider.ConfigProvider, configProvider),
    );
    const config = yield* validateEmailDeliveryConfig(state);
    const providerDeliver =
      config.provider === 'tem'
        ? makeTemDeliver({
            projectId: Option.getOrThrow(config.temProjectId),
            token: Option.getOrThrow(config.temApiToken),
          })
        : makeMailpitDeliver(config.mailpitApiUrl);

    const deliver = Effect.fn('EmailDelivery.deliver')(function* (
      request: EmailDeliveryRequest,
    ) {
      if (
        config.environment === 'staging' &&
        !config.stagingAllowlist.has(request.to.trim().toLowerCase())
      ) {
        return {
          _tag: 'Suppressed' as const,
          provider: config.provider,
          reason: 'Recipient is outside the protected staging allowlist',
        };
      }
      return yield* providerDeliver(request);
    });

    return { deliver };
  }),
}) {
  static readonly Default = Layer.effect(EmailDelivery, EmailDelivery.make);

  static readonly deliver = (request: EmailDeliveryRequest) =>
    EmailDelivery.use((delivery) => delivery.deliver(request));

  static readonly layerFake = (
    deliver: (
      request: EmailDeliveryRequest,
    ) => Effect.Effect<EmailDeliveryResult, EmailDeliveryError> = () =>
      Effect.succeed({
        _tag: 'Delivered',
        provider: 'fake',
        providerMessageId: 'fake-message-id',
      }),
  ) => Layer.succeed(EmailDelivery)({ deliver });
}
