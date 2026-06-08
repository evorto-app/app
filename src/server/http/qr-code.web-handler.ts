import { includesPermission } from '@shared/permissions/permissions';
import { and, eq } from 'drizzle-orm';
import { Effect } from 'effect';
import QRCode from 'qrcode';

import type { Context as RequestContext } from '../../types/custom/context';

import { Database, type DatabaseClient } from '../../db';
import { eventRegistrationOptions, eventRegistrations } from '../../db/schema';

const responseText = (body: string, status = 200): Response =>
  new Response(body, { status });

const databaseEffect = <A, E>(
  operation: (database: DatabaseClient) => Effect.Effect<A, E>,
) => Database.use((database) => operation(database));

export const handleQrRegistrationCodeWebRequest = (
  request: Request,
  registrationId: string,
  requestContext: RequestContext,
) =>
  Effect.gen(function* () {
    yield* Effect.logDebug('Generating QR code for registration').pipe(
      Effect.annotateLogs({ registrationId }),
    );

    const registration = yield* databaseEffect((database) =>
      database.query.eventRegistrations.findFirst({
        columns: {
          eventId: true,
          id: true,
          status: true,
          tenantId: true,
          userId: true,
        },
        where: { id: registrationId },
      }),
    );

    if (!registration) {
      return responseText('Registration not found', 404);
    }

    if (registration.status !== 'CONFIRMED') {
      return responseText('Registration not found', 404);
    }

    const requestUser = requestContext.user;
    if (
      !requestContext.authentication.isAuthenticated ||
      !requestUser ||
      requestContext.tenant.id !== registration.tenantId
    ) {
      return responseText('Registration not found', 404);
    }

    const hasOrganizerRegistration = yield* databaseEffect((database) =>
      database
        .select({ id: eventRegistrations.id })
        .from(eventRegistrations)
        .innerJoin(
          eventRegistrationOptions,
          eq(
            eventRegistrationOptions.id,
            eventRegistrations.registrationOptionId,
          ),
        )
        .where(
          and(
            eq(eventRegistrations.tenantId, registration.tenantId),
            eq(eventRegistrations.eventId, registration.eventId),
            eq(eventRegistrations.userId, requestUser.id),
            eq(eventRegistrations.status, 'CONFIRMED'),
            eq(eventRegistrationOptions.organizingRegistration, true),
          ),
        )
        .limit(1),
    ).pipe(
      Effect.map((organizerRegistrations) => organizerRegistrations.length > 0),
    );
    const canAccessRegistration =
      registration.userId === requestUser.id ||
      includesPermission('events:organizeAll', requestContext.permissions) ||
      hasOrganizerRegistration;

    if (!canAccessRegistration) {
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
      Effect.tapError(() =>
        Effect.logError('Failed to generate QR code').pipe(
          Effect.annotateLogs({
            registrationId,
            tenantDomain: tenant.domain,
          }),
        ),
      ),
      Effect.orDie,
    );

    const imageBytes = new Uint8Array(imageBuffer);
    return new Response(imageBytes, {
      headers: {
        'Content-Type': 'image/png',
      },
      status: 200,
    });
  });
