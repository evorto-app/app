import { describe, expect, it } from '@effect/vitest';
import { Effect, Layer } from 'effect';

import { Database } from '../../../../../db';
import { SimpleTemplateService } from './simple-template.service';

const validTemplateInput = {
  categoryId: 'category-1',
  description: '<p>Useful event template description</p>',
  icon: {
    iconColor: 0,
    iconName: 'calendar:fas',
  },
  location: null,
  organizerRegistration: {
    closeRegistrationOffset: 24,
    isPaid: false,
    openRegistrationOffset: 168,
    price: 0,
    registrationMode: 'fcfs' as const,
    roleIds: [],
    spots: 10,
    stripeTaxRateId: null,
  },
  participantRegistration: {
    closeRegistrationOffset: 24,
    isPaid: false,
    openRegistrationOffset: 168,
    price: 0,
    registrationMode: 'fcfs' as const,
    roleIds: [],
    spots: 10,
    stripeTaxRateId: null,
  },
  title: 'Template',
};

const testLayer = Layer.mergeAll(
  SimpleTemplateService.Default,
  Layer.succeed(Database, {} as never),
);

describe('SimpleTemplateService', () => {
  it.effect(
    'fails with bad request for non-meaningful rich text description',
    () =>
      Effect.gen(function* () {
        const program = SimpleTemplateService.createSimpleTemplate({
          input: {
            ...validTemplateInput,
            description: '<p>    </p>',
          },
          tenantId: 'tenant-1',
        }).pipe(Effect.flip, Effect.provide(testLayer));

        const error = yield* program;
        expect(error['_tag']).toBe('TemplateSimpleBadRequestError');
      }),
  );

  it.effect('fails when organizer registration opens after it closes', () =>
    Effect.gen(function* () {
      const program = SimpleTemplateService.createSimpleTemplate({
        input: {
          ...validTemplateInput,
          organizerRegistration: {
            ...validTemplateInput.organizerRegistration,
            closeRegistrationOffset: 168,
            openRegistrationOffset: 24,
          },
        },
        tenantId: 'tenant-1',
      }).pipe(Effect.flip, Effect.provide(testLayer));

      const error = yield* program;
      expect(error['_tag']).toBe('TemplateSimpleBadRequestError');
      expect(error.message).toBe(
        'organizer registration must open before it closes',
      );
    }),
  );

  it.effect('fails when participant registration opens after it closes', () =>
    Effect.gen(function* () {
      const program = SimpleTemplateService.updateSimpleTemplate({
        input: {
          id: 'template-1',
          ...validTemplateInput,
          participantRegistration: {
            ...validTemplateInput.participantRegistration,
            closeRegistrationOffset: 168,
            openRegistrationOffset: 24,
          },
        },
        tenantId: 'tenant-1',
      }).pipe(Effect.flip, Effect.provide(testLayer));

      const error = yield* program;
      expect(error['_tag']).toBe('TemplateSimpleBadRequestError');
      expect(error.message).toBe(
        'participant registration must open before it closes',
      );
    }),
  );
});
