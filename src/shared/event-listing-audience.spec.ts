import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  EventListingAudience,
  eventListingAudiences,
} from './event-listing-audience';

describe('EventListingAudience', () => {
  it('accepts exactly the four product audiences', () => {
    for (const audience of eventListingAudiences) {
      expect(Schema.decodeUnknownSync(EventListingAudience)(audience)).toBe(
        audience,
      );
    }

    for (const unsupported of [false, true, 'listed', 'participants']) {
      expect(() =>
        Schema.decodeUnknownSync(EventListingAudience)(unsupported),
      ).toThrow();
    }
  });
});
