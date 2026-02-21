import { Effect } from 'effect';
import QRCode from 'qrcode';

import { Database, type DatabaseClient } from '../../db';

const responseText = (body: string, status = 200): Response =>
  new Response(body, { status });

const databaseEffect = <A, E>(
  operation: (database: DatabaseClient) => Effect.Effect<A, E, never>,
) => Database.pipe(Effect.flatMap((database) => operation(database)));

export const handleQrRegistrationCodeWebRequest = (
  request: Request,
  registrationId: string,
) =>
  Effect.gen(function* () {
    yield* Effect.logDebug('Generating QR code for registration').pipe(
      Effect.annotateLogs({ registrationId }),
    );

    const registration = yield* databaseEffect((database) =>
      database.query.eventRegistrations.findFirst({
        columns: {
          id: true,
          tenantId: true,
        },
        where: { id: registrationId },
      }),
    );

    if (!registration) {
      return responseText('Registration not found', 404);
    }

    const tenant = yield* databaseEffect((database) =>
      database.query.tenants.findFirst({
        columns: {
          domain: true,
        },
        where: { id: registration.tenantId },
      }),
    );

    if (!tenant) {
      return responseText('Tenant not found', 404);
    }

    const requestUrl = new URL(request.url);
    const protocol = requestUrl.protocol.slice(0, -1);
    const scanTargetUrl = `${protocol}://${tenant.domain}/scan/registration/${registration.id}`;

    const imageBuffer = yield* Effect.promise(() =>
      QRCode.toBuffer(scanTargetUrl, {
        errorCorrectionLevel: 'H',
        type: 'png',
        width: 200,
      }),
    ).pipe(
      Effect.catchAll(() =>
        Effect.gen(function* () {
          yield* Effect.logError('Failed to generate QR code').pipe(
            Effect.annotateLogs({
              registrationId,
              tenantDomain: tenant.domain,
            }),
          );
          return Buffer.alloc(0);
        }),
      ),
    );

    if (imageBuffer.byteLength === 0) {
      return responseText('Failed to generate QR code', 500);
    }

    const imageBytes = new Uint8Array(imageBuffer);
    return new Response(imageBytes, {
      headers: {
        'Content-Type': 'image/png',
      },
      status: 200,
    });
  });
