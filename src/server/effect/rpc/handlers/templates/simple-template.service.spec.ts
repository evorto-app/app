import { describe, expect, it } from '@effect/vitest';
import { Effect, Layer } from 'effect';

import { Database } from '../../../../../db';
import {
  buildRegistrationOptionInsert,
  buildTemplateInsertValues,
  buildTemplateOptionDiscountInsert,
  SimpleTemplateService,
} from './simple-template.service';

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
    title: 'Organizer registration',
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
    title: 'Participant registration',
  },
  title: 'Template',
};

const testLayer = Layer.mergeAll(
  SimpleTemplateService.Default,
  Layer.succeed(Database, {} as never),
);

const createValidationDatabase = ({
  categoryFound,
  roleIds,
  taxRate,
}: {
  categoryFound: boolean;
  roleIds: readonly string[];
  taxRate?: { active: boolean; inclusive: boolean };
}) =>
  ({
    query: {
      eventTemplateCategories: {
        findFirst: () =>
          Effect.succeed(categoryFound ? { id: 'category-1' } : undefined),
      },
      roles: {
        findMany: () => Effect.succeed(roleIds.map((id) => ({ id }))),
      },
      tenantStripeTaxRates: {
        findFirst: () => Effect.succeed(taxRate),
        findMany: () => Effect.succeed([]),
      },
    },
  }) as never;

const createValidationLayer = (database: never) =>
  Layer.mergeAll(
    SimpleTemplateService.Default,
    Layer.succeed(Database, database),
  );

describe('SimpleTemplateService', () => {
  it('trims organizer planning tips before template insert', () => {
    expect(
      buildTemplateInsertValues({
        input: {
          ...validTemplateInput,
          planningTips: '  Bring printed waiver forms.\nCheck room access.  ',
        },
        sanitizedDescription: '<p>Clean description</p>',
        tenantId: 'tenant-1',
      }),
    ).toMatchObject({
      planningTips: 'Bring printed waiver forms.\nCheck room access.',
    });
  });

  it('stores blank organizer planning tips as null', () => {
    expect(
      buildTemplateInsertValues({
        input: {
          ...validTemplateInput,
          planningTips: '   ',
        },
        sanitizedDescription: '<p>Clean description</p>',
        tenantId: 'tenant-1',
      }),
    ).toMatchObject({
      planningTips: null,
    });
  });

  it('keeps reusable registration option copy on template inserts', () => {
    expect(
      buildRegistrationOptionInsert({
        input: {
          ...validTemplateInput.participantRegistration,
          description: '<p> Public participant instructions </p>',
          registeredDescription: '<p> Bring your ticket QR code. </p>',
          title: 'Early bird ticket',
        },
        organizingRegistration: false,
        templateId: 'template-1',
      }),
    ).toMatchObject({
      description: '<p> Public participant instructions </p>',
      registeredDescription: '<p> Bring your ticket QR code. </p>',
      title: 'Early bird ticket',
    });
  });

  it('stores blank registration option rich text as null', () => {
    expect(
      buildRegistrationOptionInsert({
        input: {
          ...validTemplateInput.organizerRegistration,
          description: '<p> </p>',
          registeredDescription: '',
          title: '  Organizer ticket  ',
        },
        organizingRegistration: true,
        templateId: 'template-1',
      }),
    ).toMatchObject({
      description: null,
      registeredDescription: null,
      title: 'Organizer ticket',
    });
  });

  it('builds ESNcard discount inserts for paid registration options', () => {
    expect(
      buildTemplateOptionDiscountInsert({
        input: {
          ...validTemplateInput.participantRegistration,
          esnCardDiscountedPrice: 1900,
          isPaid: true,
          price: 2500,
          stripeTaxRateId: 'txr_vat_19',
        },
        registrationOptionId: 'option-1',
      }),
    ).toEqual({
      discountedPrice: 1900,
      discountType: 'esnCard',
      registrationOptionId: 'option-1',
    });
  });

  it('skips ESNcard discount inserts for free or empty discounts', () => {
    expect(
      buildTemplateOptionDiscountInsert({
        input: {
          ...validTemplateInput.participantRegistration,
          esnCardDiscountedPrice: 1900,
          isPaid: false,
          price: 0,
        },
        registrationOptionId: 'option-1',
      }),
    ).toBeNull();
    expect(
      buildTemplateOptionDiscountInsert({
        input: {
          ...validTemplateInput.participantRegistration,
          esnCardDiscountedPrice: null,
          isPaid: true,
          price: 2500,
          stripeTaxRateId: 'txr_vat_19',
        },
        registrationOptionId: 'option-1',
      }),
    ).toBeNull();
  });

  it.effect(
    'fails with bad request for non-meaningful rich text description',
    () =>
      Effect.gen(function* () {
        const program = SimpleTemplateService.createSimpleTemplate({
          esnCardEnabled: false,
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
        esnCardEnabled: false,
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
        esnCardEnabled: false,
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

  it.effect('fails when the selected category is not tenant-owned', () =>
    Effect.gen(function* () {
      const program = SimpleTemplateService.createSimpleTemplate({
        esnCardEnabled: false,
        input: {
          ...validTemplateInput,
          organizerRegistration: {
            ...validTemplateInput.organizerRegistration,
            roleIds: ['role-1'],
          },
        },
        tenantId: 'tenant-1',
      }).pipe(
        Effect.flip,
        Effect.provide(
          createValidationLayer(
            createValidationDatabase({ categoryFound: false, roleIds: [] }),
          ),
        ),
      );

      const error = yield* program;
      expect(error['_tag']).toBe('TemplateSimpleBadRequestError');
      expect(error.message).toBe(
        'Template category does not exist for this tenant',
      );
    }),
  );

  it.effect('fails when a selected role is not tenant-owned', () =>
    Effect.gen(function* () {
      const program = SimpleTemplateService.updateSimpleTemplate({
        esnCardEnabled: false,
        input: {
          id: 'template-1',
          ...validTemplateInput,
          organizerRegistration: {
            ...validTemplateInput.organizerRegistration,
            roleIds: ['role-1'],
          },
          participantRegistration: {
            ...validTemplateInput.participantRegistration,
            roleIds: ['role-2'],
          },
        },
        tenantId: 'tenant-1',
      }).pipe(
        Effect.flip,
        Effect.provide(
          createValidationLayer(
            createValidationDatabase({
              categoryFound: true,
              roleIds: ['role-1'],
            }),
          ),
        ),
      );

      const error = yield* program;
      expect(error['_tag']).toBe('TemplateSimpleBadRequestError');
      expect(error.message).toBe(
        'Registration role does not exist for this tenant',
      );
    }),
  );

  it.effect('fails when a paid registration omits a tax rate', () =>
    Effect.gen(function* () {
      const program = SimpleTemplateService.createSimpleTemplate({
        esnCardEnabled: false,
        input: {
          ...validTemplateInput,
          participantRegistration: {
            ...validTemplateInput.participantRegistration,
            isPaid: true,
            price: 2500,
            stripeTaxRateId: null,
          },
        },
        tenantId: 'tenant-1',
      }).pipe(
        Effect.flip,
        Effect.provide(
          createValidationLayer(
            createValidationDatabase({ categoryFound: true, roleIds: [] }),
          ),
        ),
      );

      const error = yield* program;
      expect(error['_tag']).toBe('TemplateSimpleBadRequestError');
      expect(error.message).toBe(
        'participant registration tax rate validation failed',
      );
    }),
  );

  it.effect('fails when a free registration keeps a stale tax rate', () =>
    Effect.gen(function* () {
      const program = SimpleTemplateService.updateSimpleTemplate({
        esnCardEnabled: false,
        input: {
          id: 'template-1',
          ...validTemplateInput,
          organizerRegistration: {
            ...validTemplateInput.organizerRegistration,
            isPaid: false,
            price: 0,
            stripeTaxRateId: 'txr_stale',
          },
        },
        tenantId: 'tenant-1',
      }).pipe(
        Effect.flip,
        Effect.provide(
          createValidationLayer(
            createValidationDatabase({ categoryFound: true, roleIds: [] }),
          ),
        ),
      );

      const error = yield* program;
      expect(error['_tag']).toBe('TemplateSimpleBadRequestError');
      expect(error.message).toBe(
        'organizer registration tax rate validation failed',
      );
    }),
  );

  it.effect('fails when ESNcard discounts are not enabled for the tenant', () =>
    Effect.gen(function* () {
      const program = SimpleTemplateService.createSimpleTemplate({
        esnCardEnabled: false,
        input: {
          ...validTemplateInput,
          participantRegistration: {
            ...validTemplateInput.participantRegistration,
            esnCardDiscountedPrice: 1900,
            isPaid: true,
            price: 2500,
            stripeTaxRateId: 'txr_vat_19',
          },
        },
        tenantId: 'tenant-1',
      }).pipe(
        Effect.flip,
        Effect.provide(
          createValidationLayer(
            createValidationDatabase({
              categoryFound: true,
              roleIds: [],
              taxRate: { active: true, inclusive: true },
            }),
          ),
        ),
      );

      const error = yield* program;
      expect(error['_tag']).toBe('TemplateSimpleBadRequestError');
      expect(error.message).toBe(
        'participant registration ESNcard discounts are not enabled',
      );
    }),
  );

  it.effect('fails when ESNcard discounts exceed the base price', () =>
    Effect.gen(function* () {
      const program = SimpleTemplateService.updateSimpleTemplate({
        esnCardEnabled: true,
        input: {
          id: 'template-1',
          ...validTemplateInput,
          organizerRegistration: {
            ...validTemplateInput.organizerRegistration,
            esnCardDiscountedPrice: 2600,
            isPaid: true,
            price: 2500,
            stripeTaxRateId: 'txr_vat_19',
          },
        },
        tenantId: 'tenant-1',
      }).pipe(
        Effect.flip,
        Effect.provide(
          createValidationLayer(
            createValidationDatabase({
              categoryFound: true,
              roleIds: [],
              taxRate: { active: true, inclusive: true },
            }),
          ),
        ),
      );

      const error = yield* program;
      expect(error['_tag']).toBe('TemplateSimpleBadRequestError');
      expect(error.message).toBe(
        'organizer registration ESNcard discount cannot exceed price',
      );
    }),
  );
});
