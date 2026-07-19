import { describe, expect, it } from '@effect/vitest';
import { Effect, Schema } from 'effect';

import {
  PlatformEventDetailRecord,
  PlatformEventFormOptionsRecord,
  PlatformEventRegistrationOptionRecord,
  PlatformEventsCreateInput,
  PlatformEventsReviewInput,
  PlatformEventsUpdateInput,
  PlatformRegistrationsCheckInInput,
  PlatformTemplateFormOptionsRecord,
  PlatformTemplatesCreateInput,
  PlatformTemplatesUpdateInput,
} from './platform-events.rpcs';
import { TemplateGraphRecord } from './templates.rpcs';

describe('platform event administration RPC schemas', () => {
  it.effect('requires a valid target-tenant timezone in form options', () =>
    Effect.gen(function* () {
      const options = {
        creators: [],
        esnCardEnabled: false,
        roles: [],
        taxRates: [],
        templates: [],
        timezone: 'Australia/Brisbane',
      };

      expect(
        (yield* Schema.decodeUnknownEffect(PlatformEventFormOptionsRecord)(
          options,
        )).timezone,
      ).toBe('Australia/Brisbane');

      const invalid = yield* Schema.decodeUnknownEffect(
        PlatformEventFormOptionsRecord,
      )({ ...options, timezone: 'not/a-timezone' }).pipe(Effect.flip);
      expect(invalid['_tag']).toBe('SchemaError');
    }),
  );

  it.effect('returns target-organization icon choices for template forms', () =>
    Effect.gen(function* () {
      const options = yield* Schema.decodeUnknownEffect(
        PlatformTemplateFormOptionsRecord,
      )({
        categories: [{ id: 'category-1', title: 'Trips' }],
        esnCardEnabled: false,
        iconChoices: [
          {
            commonName: 'calendar:fas',
            friendlyName: 'Calendar',
            id: 'icon-1',
            sourceColor: 42,
          },
        ],
      });

      expect(options.iconChoices[0]).toEqual({
        commonName: 'calendar:fas',
        friendlyName: 'Calendar',
        id: 'icon-1',
        sourceColor: 42,
      });
    }),
  );

  it.effect(
    'requires explicit creator, target tenant, template, and reason',
    () =>
      Effect.gen(function* () {
        const input = {
          creatorUserId: 'user-1',
          description: 'A useful event description',
          end: '2026-07-10T14:00:00.000Z',
          reason: 'Create an operational event for the tenant',
          start: '2026-07-10T12:00:00.000Z',
          targetTenantId: 'tenant-1',
          templateId: 'template-1',
          title: 'Event',
        };
        expect(
          yield* Schema.decodeUnknownEffect(PlatformEventsCreateInput)(input),
        ).toEqual(input);

        const missingCreator = yield* Schema.decodeUnknownEffect(
          PlatformEventsCreateInput,
        )({ ...input, creatorUserId: '' }).pipe(Effect.flip);
        expect(missingCreator['_tag']).toBe('SchemaError');

        const missingReason = yield* Schema.decodeUnknownEffect(
          PlatformEventsCreateInput,
        )({ ...input, reason: '' }).pipe(Effect.flip);
        expect(missingReason['_tag']).toBe('SchemaError');
      }),
  );

  it.effect(
    'keeps legacy random event records readable but rejects random updates',
    () =>
      Effect.gen(function* () {
        const registrationOption = {
          cancellationDeadlineHoursBeforeStart: null,
          checkedInSpots: 0,
          closeRegistrationTime: '2026-07-10T11:00:00.000Z',
          confirmedSpots: 0,
          description: null,
          esnCardDiscountedPrice: null,
          id: 'option-1',
          isPaid: false,
          openRegistrationTime: '2026-07-01T12:00:00.000Z',
          organizingRegistration: false,
          price: 0,
          refundFeesOnCancellation: null,
          registeredDescription: null,
          registrationMode: 'fcfs',
          roleIds: [],
          spots: 20,
          stripeTaxRateId: null,
          title: 'Participants',
          transferDeadlineHoursBeforeStart: null,
        } as const;
        const update = {
          addOns: [],
          description: '<p>Supported event update</p>',
          end: '2026-07-10T14:00:00.000Z',
          eventId: 'event-1',
          icon: { iconColor: 1, iconName: 'calendar:fas' },
          location: null,
          questions: [],
          reason: 'Maintain the supported event graph',
          registrationOptions: [registrationOption],
          start: '2026-07-10T12:00:00.000Z',
          targetTenantId: 'tenant-1',
          title: 'Event',
        };

        expect(
          (yield* Schema.decodeUnknownEffect(PlatformEventsUpdateInput)(update))
            .registrationOptions[0]?.registrationMode,
        ).toBe('fcfs');

        const detail = {
          addOns: [],
          creator: {
            email: 'owner@example.org',
            firstName: 'Event',
            id: 'owner-1',
            lastName: 'Owner',
          },
          description: update.description,
          end: update.end,
          icon: update.icon,
          id: update.eventId,
          location: update.location,
          questions: [],
          registrationCount: 0,
          registrationOptions: update.registrationOptions,
          reviewedAt: null,
          simpleModeEnabled: true,
          start: update.start,
          status: 'DRAFT' as const,
          statusComment: null,
          title: update.title,
          unlisted: false,
        };
        expect(
          (yield* Schema.decodeUnknownEffect(PlatformEventDetailRecord)(detail))
            .simpleModeEnabled,
        ).toBe(true);
        const { simpleModeEnabled: _simpleModeEnabled, ...detailWithoutMode } =
          detail;
        const detailError = yield* Schema.decodeUnknownEffect(
          PlatformEventDetailRecord,
        )(detailWithoutMode).pipe(Effect.flip);
        expect(detailError['_tag']).toBe('SchemaError');

        const randomOption = {
          ...registrationOption,
          registrationMode: 'random',
        } as const;
        expect(
          (yield* Schema.decodeUnknownEffect(
            PlatformEventRegistrationOptionRecord,
          )(randomOption)).registrationMode,
        ).toBe('random');

        const updateError = yield* Schema.decodeUnknownEffect(
          PlatformEventsUpdateInput,
        )({ ...update, registrationOptions: [randomOption] }).pipe(Effect.flip);
        expect(updateError['_tag']).toBe('SchemaError');
      }),
  );

  it.effect(
    'accepts supported full template graphs and rejects random writes',
    () =>
      Effect.gen(function* () {
        const graph = {
          addOns: [
            {
              allowMultiple: true,
              allowPurchaseBeforeEvent: true,
              allowPurchaseDuringEvent: false,
              allowPurchaseDuringRegistration: true,
              description: null,
              isPaid: false,
              key: 'addon-key',
              maxQuantityPerUser: 2,
              price: 0,
              registrationOptions: [
                {
                  includedQuantity: 1,
                  optionalPurchaseQuantity: 0,
                  registrationOptionKey: 'organizer-key',
                },
                {
                  includedQuantity: 0,
                  optionalPurchaseQuantity: 2,
                  registrationOptionKey: 'participant-key',
                },
              ],
              stripeTaxRateId: null,
              title: 'Shared add-on',
              totalAvailableQuantity: 20,
            },
          ],
          categoryId: 'category-1',
          description: '<p>Full template graph</p>',
          icon: { iconColor: 1, iconName: 'calendar:fas' },
          location: null,
          planningTips: null,
          questions: [
            {
              description: null,
              key: 'question-key',
              registrationOptionKey: 'participant-key',
              required: true,
              sortOrder: 0,
              title: 'Question',
            },
          ],
          reason: 'Maintain the complete tenant template graph',
          registrationOptions: [
            {
              cancellationDeadlineHoursBeforeStart: null,
              closeRegistrationOffset: 24,
              description: null,
              esnCardDiscountedPrice: null,
              isPaid: false,
              key: 'organizer-key',
              openRegistrationOffset: 168,
              organizingRegistration: true,
              price: 0,
              refundFeesOnCancellation: null,
              registeredDescription: null,
              registrationMode: 'application',
              roleIds: ['organizer-role'],
              spots: 5,
              stripeTaxRateId: null,
              title: 'Organizers',
              transferDeadlineHoursBeforeStart: null,
            },
            {
              cancellationDeadlineHoursBeforeStart: null,
              closeRegistrationOffset: 12,
              description: null,
              esnCardDiscountedPrice: null,
              isPaid: false,
              key: 'participant-key',
              openRegistrationOffset: 240,
              organizingRegistration: false,
              price: 0,
              refundFeesOnCancellation: null,
              registeredDescription: null,
              registrationMode: 'fcfs',
              roleIds: ['participant-role'],
              spots: 30,
              stripeTaxRateId: null,
              title: 'Participants',
              transferDeadlineHoursBeforeStart: null,
            },
          ],
          simpleModeEnabled: false,
          targetTenantId: 'tenant-1',
          title: 'Advanced template',
          unlisted: true,
        };

        const created = yield* Schema.decodeUnknownEffect(
          PlatformTemplatesCreateInput,
        )(graph);
        expect(created.registrationOptions[1]?.registrationMode).toBe('fcfs');
        expect(created.addOns[0]?.registrationOptions).toHaveLength(2);

        const updated = yield* Schema.decodeUnknownEffect(
          PlatformTemplatesUpdateInput,
        )({ ...graph, templateId: 'template-1' });
        expect(updated.templateId).toBe('template-1');

        const randomGraph = {
          ...graph,
          registrationOptions: graph.registrationOptions.map((option, index) =>
            index === 1 ? { ...option, registrationMode: 'random' } : option,
          ),
        };
        const createError = yield* Schema.decodeUnknownEffect(
          PlatformTemplatesCreateInput,
        )(randomGraph).pipe(Effect.flip);
        expect(createError['_tag']).toBe('SchemaError');

        const updateError = yield* Schema.decodeUnknownEffect(
          PlatformTemplatesUpdateInput,
        )({ ...randomGraph, templateId: 'template-1' }).pipe(Effect.flip);
        expect(updateError['_tag']).toBe('SchemaError');
      }),
  );

  it.effect('keeps legacy random template records readable', () =>
    Effect.gen(function* () {
      const legacyRecord = yield* Schema.decodeUnknownEffect(
        TemplateGraphRecord,
      )({
        addOns: [],
        categoryId: 'category-1',
        description: '<p>Legacy template</p>',
        icon: { iconColor: 1, iconName: 'calendar:fas' },
        id: 'template-1',
        location: null,
        planningTips: null,
        questions: [],
        registrationOptions: [
          {
            cancellationDeadlineHoursBeforeStart: null,
            closeRegistrationOffset: 12,
            description: null,
            esnCardDiscountedPrice: null,
            id: 'option-1',
            isPaid: false,
            openRegistrationOffset: 168,
            organizingRegistration: false,
            price: 0,
            refundFeesOnCancellation: null,
            registeredDescription: null,
            registrationMode: 'random',
            roleIds: ['member-role'],
            roles: [{ id: 'member-role', name: 'Member' }],
            spots: 20,
            stripeTaxRateId: null,
            title: 'Legacy random participants',
            transferDeadlineHoursBeforeStart: null,
          },
        ],
        simpleModeEnabled: false,
        title: 'Legacy random template',
        unlisted: false,
      });

      expect(legacyRecord.registrationOptions[0]?.registrationMode).toBe(
        'random',
      );
    }),
  );

  it.effect(
    'bounds every mutation reason and keeps review feedback separate',
    () =>
      Effect.gen(function* () {
        const review = yield* Schema.decodeUnknownEffect(
          PlatformEventsReviewInput,
        )({
          approved: false,
          comment: 'Please clarify the participant plan',
          eventId: 'event-1',
          reason: 'Return the event for a content correction',
          targetTenantId: 'tenant-1',
        });
        expect(review.comment).toBe('Please clarify the participant plan');

        const longReason = yield* Schema.decodeUnknownEffect(
          PlatformEventsReviewInput,
        )({
          ...review,
          reason: 'x'.repeat(501),
        }).pipe(Effect.flip);
        expect(longReason['_tag']).toBe('SchemaError');
      }),
  );

  it.effect(
    'preserves explicit target and reason on template and check-in writes',
    () =>
      Effect.gen(function* () {
        const checkIn = yield* Schema.decodeUnknownEffect(
          PlatformRegistrationsCheckInInput,
        )({
          guestCheckInCount: 1,
          reason: 'Assist the event team at the venue',
          registrationId: 'registration-1',
          targetTenantId: 'tenant-1',
        });
        expect(checkIn.targetTenantId).toBe('tenant-1');

        const templateError = yield* Schema.decodeUnknownEffect(
          PlatformTemplatesCreateInput,
        )({
          reason: 'Create a tenant template',
          targetTenantId: 'tenant-1',
        }).pipe(Effect.flip);
        expect(templateError['_tag']).toBe('SchemaError');
      }),
  );
});
