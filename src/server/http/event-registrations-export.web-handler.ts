import { Effect } from 'effect';

import type { Context as RequestContext } from '../../types/custom/context';

import { Database, type DatabaseClient } from '../../db';
import { canOrganizeEvent } from '../effect/rpc/handlers/events/events-query.handlers';
import { encodeCsv } from '../exports/csv';
import {
  buildEventRegistrationsCsvRows,
  type EventRegistrationsCsvRegistration,
  registrationsContentDisposition,
} from '../exports/event-registrations-csv';

const textResponse = (body: string, status: number): Response =>
  new Response(body, {
    headers: {
      'Cache-Control': 'private, no-store',
      'Content-Type': 'text/plain; charset=utf-8',
    },
    status,
  });

const databaseEffect = <A, E>(
  operation: (database: DatabaseClient) => Effect.Effect<A, E, never>,
) => Database.use((database) => operation(database));

/**
 * Per-event registrations CSV download for organizers. Access mirrors the
 * organize overview (`events.getOrganizeOverview`), and the rows are the
 * registrations that overview lists.
 */
export const handleEventRegistrationsExportWebRequest = (
  eventId: string,
  requestContext: RequestContext,
) =>
  Effect.gen(function* () {
    yield* Effect.logDebug('Exporting event registrations as CSV').pipe(
      Effect.annotateLogs({ eventId }),
    );

    const user = requestContext.user;
    if (!requestContext.authentication.isAuthenticated || !user) {
      return textResponse('Sign in to download this export.', 401);
    }

    const tenantId = requestContext.tenant.id;
    const event = yield* databaseEffect((database) =>
      database.query.eventInstances.findFirst({
        columns: { id: true, title: true },
        where: { id: eventId, tenantId },
      }),
    );
    if (!event) {
      return textResponse('Event not found.', 404);
    }

    const canOrganize = yield* canOrganizeEvent({
      eventId: event.id,
      permissions: user.permissions,
      tenantId,
      userId: user.id,
    });
    if (!canOrganize) {
      return textResponse('Organizer access required.', 403);
    }

    const options = yield* databaseEffect((database) =>
      database.query.eventRegistrationOptions.findMany({
        columns: { id: true, organizingRegistration: true, title: true },
        where: { eventId: event.id },
      }),
    );
    const questions = yield* databaseEffect((database) =>
      database.query.eventRegistrationQuestions.findMany({
        columns: {
          id: true,
          registrationOptionId: true,
          sortOrder: true,
          title: true,
        },
        where: { eventId: event.id },
      }),
    );
    const registrationRecords = yield* databaseEffect((database) =>
      database.query.eventRegistrations.findMany({
        columns: {
          checkInTime: true,
          registrationOptionId: true,
          status: true,
        },
        where: {
          eventId: event.id,
          status: { NOT: 'CANCELLED' },
          tenantId,
        },
        with: {
          questionAnswers: { columns: { answer: true, questionId: true } },
          registrationOption: { columns: { registrationMode: true } },
          user: {
            columns: {
              communicationEmail: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      }),
    );

    const registrations = registrationRecords.flatMap(
      (record): EventRegistrationsCsvRegistration[] => {
        const { registrationOption, user: registrant } = record;
        if (!registrationOption || !registrant) {
          return [];
        }
        const status =
          record.status === 'CONFIRMED' ||
          (record.status === 'PENDING' &&
            registrationOption.registrationMode === 'application')
            ? record.status
            : undefined;
        if (!status) {
          return [];
        }
        return [
          {
            answers: record.questionAnswers,
            checkInTime: record.checkInTime,
            email: registrant.communicationEmail,
            firstName: registrant.firstName,
            lastName: registrant.lastName,
            registrationOptionId: record.registrationOptionId,
            status,
          },
        ];
      },
    );

    const csv = encodeCsv(
      buildEventRegistrationsCsvRows({
        options,
        questions,
        registrations,
        timeZone: requestContext.tenant.timezone,
      }),
    );

    return new Response(csv, {
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Disposition': registrationsContentDisposition(event.title),
        'Content-Type': 'text/csv; charset=utf-8',
      },
      status: 200,
    });
  });
