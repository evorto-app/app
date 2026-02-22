import { Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';

import { Database } from '../../../../../db';
import { SimpleTemplateService } from './simple-template.service';

describe('SimpleTemplateService', () => {
  it('fails with bad request for non-meaningful rich text description', async () => {
    const program = SimpleTemplateService.createSimpleTemplate({
      input: {
        categoryId: 'category-1',
        description: '<p>    </p>',
        icon: {
          iconColor: 0,
          iconName: 'calendar:fas',
        },
        location: null,
        organizerRegistration: {
          closeRegistrationOffset: 0,
          isPaid: false,
          openRegistrationOffset: 0,
          price: 0,
          registrationMode: 'fcfs',
          roleIds: [],
          spots: 10,
          stripeTaxRateId: null,
        },
        participantRegistration: {
          closeRegistrationOffset: 0,
          isPaid: false,
          openRegistrationOffset: 0,
          price: 0,
          registrationMode: 'fcfs',
          roleIds: [],
          spots: 10,
          stripeTaxRateId: null,
        },
        title: 'Template',
      },
      tenantId: 'tenant-1',
    }).pipe(
      Effect.flip,
      Effect.provide(SimpleTemplateService.Default),
      Effect.provide(Layer.succeed(Database, {} as never)),
    );

    const error = await Effect.runPromise(program);
    expect(error['_tag']).toBe('TemplateSimpleBadRequestError');
  });
});
