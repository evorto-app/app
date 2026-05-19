import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  TemplateFindOneRecord,
  TemplateSimpleInput,
} from '../../../../../shared/rpc-contracts/app-rpcs/templates.rpcs';

const validSimpleTemplateInput = {
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

const validTemplateFindOneRecord = {
  categoryId: 'category-1',
  description: '<p>Useful event template description</p>',
  icon: {
    iconColor: 0,
    iconName: 'calendar:fas',
  },
  id: 'template-1',
  location: null,
  registrationOptions: [],
  title: 'Template',
};

const validGoogleLocation = {
  address: 'Example Street 1',
  coordinates: {
    lat: 52.37,
    lng: 4.9,
  },
  name: 'Example Place',
  placeId: 'place-1',
  type: 'google' as const,
};

describe('templates RPC location schema', () => {
  it('accepts structured template input locations', () => {
    expect(() =>
      Schema.decodeUnknownSync(TemplateSimpleInput)({
        ...validSimpleTemplateInput,
        location: validGoogleLocation,
      }),
    ).not.toThrow();
  });

  it('rejects malformed template input locations', () => {
    expect(() =>
      Schema.decodeUnknownSync(TemplateSimpleInput)({
        ...validSimpleTemplateInput,
        location: {
          name: 'Broken Place',
          placeId: 'place-1',
          type: 'google',
        },
      }),
    ).toThrow();
  });

  it('rejects malformed template response locations', () => {
    expect(() =>
      Schema.decodeUnknownSync(TemplateFindOneRecord)({
        ...validTemplateFindOneRecord,
        location: {
          meetingProvider: 'zoom',
          name: 'Broken Place',
          type: 'online',
        },
      }),
    ).toThrow();
  });
});
