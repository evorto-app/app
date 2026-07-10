import { Effect } from 'effect';
import QRCode from 'qrcode';

import type { Context as RequestContext } from '../../types/custom/context';

import { Database, type DatabaseClient } from '../../db';
import {
  includesPermission,
  type Permission,
} from '../../shared/permissions/permissions';
import { tenantOutboundUrl } from '../tenant-outbound-url';

const responseText = (body: string, status = 200): Response =>
  new Response(body, { status });

const databaseEffect = <A, E>(
  operation: (database: DatabaseClient) => Effect.Effect<A, E, never>,
) => Database.use((database) => operation(database));

interface RegistrationQrRecord {
  eventId: string;
  id: string;
  status: string;
  tenantId: string;
  userId: string;
}

const canManageRegistrationQr = ({
  eventId,
  tenantId,
  user,
}: {
  eventId: string;
  tenantId: string;
  user: {
    id: string;
    permissions: readonly Permission[];
  };
}) =>
  Effect.gen(function* () {
    if (includesPermission('events:organizeAll', user.permissions)) {
      return true;
    }

    const organizerRegistrations = yield* databaseEffect((database) =>
      database.query.eventRegistrations.findMany({
        columns: {
          id: true,
        },
        where: {
          eventId,
          status: 'CONFIRMED',
          tenantId,
          userId: user.id,
        },
        with: {
          registrationOption: {
            columns: {
              organizingRegistration: true,
            },
          },
        },
      }),
    );

    return organizerRegistrations.some(
      (registration) =>
        registration.registrationOption?.organizingRegistration === true,
    );
  });

const canReadRegistrationQr = ({
  registration,
  requestContext,
}: {
  registration: RegistrationQrRecord;
  requestContext: RequestContext;
}) =>
  Effect.gen(function* () {
    const user = requestContext.user;
    if (!requestContext.authentication.isAuthenticated || !user) {
      return false;
    }

    if (requestContext.tenant.id !== registration.tenantId) {
      return false;
    }

    if (registration.status !== 'CONFIRMED') {
      return false;
    }

    if (registration.userId === user.id) {
      return true;
    }

    return yield* canManageRegistrationQr({
      eventId: registration.eventId,
      tenantId: registration.tenantId,
      user,
    });
  });

export const handleQrRegistrationCodeWebRequest = (
  _request: Request,
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

    const canReadQr = yield* canReadRegistrationQr({
      registration,
      requestContext,
    });
    if (!canReadQr) {
      return responseText(
        requestContext.authentication.isAuthenticated
          ? 'Registration not found'
          : 'Authentication required',
        requestContext.authentication.isAuthenticated ? 404 : 401,
      );
    }

    const tenant = yield* databaseEffect((database) =>
      database.query.tenants.findFirst({
        columns: {
          canonicalRootUrl: true,
          domain: true,
        },
        where: { id: registration.tenantId },
      }),
    );

    if (!tenant) {
      return responseText('Tenant not found', 404);
    }

    const scanTargetUrl = yield* tenantOutboundUrl(
      tenant,
      `/scan/registration/${encodeURIComponent(registration.id)}`,
    ).pipe(
      Effect.tapError(() =>
        Effect.logError('Failed to build registration scan URL').pipe(
          Effect.annotateLogs({
            registrationId,
            tenantDomain: tenant.domain,
          }),
        ),
      ),
      Effect.orDie,
    );

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
