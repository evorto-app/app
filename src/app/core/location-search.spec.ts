import { TestBed } from '@angular/core/testing';
import { assert, beforeEach, describe, expect, it, vi } from '@effect/vitest';
import {
  importLibrary as googleMapsImportLibrary,
  setOptions as googleMapsSetOptions,
} from '@googlemaps/js-api-loader';
import { Effect } from 'effect';

import { ConfigService } from './config.service';
import {
  decodeLocationSuggestions,
  GOOGLE_MAPS_LOADER,
  GooglePlaceReference,
  LocationProviderError,
  LocationSearch,
} from './location-search';

describe('LocationSearch', () => {
  const config: {
    publicConfig: { googleMapsApiKey: string };
  } = {
    publicConfig: {
      googleMapsApiKey: 'maps-key',
    },
  };
  const loader = {
    importLibrary: vi.fn<typeof googleMapsImportLibrary>(),
    setOptions: vi.fn<typeof googleMapsSetOptions>(),
  };
  let locationSearch: LocationSearch;

  beforeEach(() => {
    config.publicConfig.googleMapsApiKey = 'maps-key';
    loader.importLibrary.mockReset();
    loader.setOptions.mockReset();
    TestBed.configureTestingModule({
      providers: [
        LocationSearch,
        { provide: ConfigService, useValue: config },
        { provide: GOOGLE_MAPS_LOADER, useValue: loader },
      ],
    });
    locationSearch = TestBed.inject(LocationSearch);
  });

  it.effect('preserves the provider cause when the Places library fails', () =>
    Effect.gen(function* () {
      const providerCause = new Error('provider unavailable');
      loader.importLibrary.mockRejectedValue(providerCause);

      const failure = yield* locationSearch.search('Berlin').pipe(Effect.flip);

      assert.instanceOf(failure, LocationProviderError);
      assert.strictEqual(failure.operation, 'initialize');
      assert.strictEqual(failure.cause, providerCause);
      assert.strictEqual(loader.setOptions.mock.calls.length, 1);
    }),
  );

  it.effect('preserves place-detail provider failures', () =>
    Effect.gen(function* () {
      const providerCause = new Error('details unavailable');
      const fetchFields = vi.fn<GooglePlaceReference['fetchFields']>();
      fetchFields.mockRejectedValue(providerCause);
      const place: GooglePlaceReference = {
        displayName: null,
        fetchFields,
        formattedAddress: null,
        id: 'place-1',
        location: null,
      };

      const failure = yield* locationSearch
        .getPlaceDetails(place)
        .pipe(Effect.flip);

      assert.instanceOf(failure, LocationProviderError);
      assert.strictEqual(failure.operation, 'placeDetails');
      assert.strictEqual(failure.cause, providerCause);
    }),
  );

  it('accepts unloaded place details without hiding malformed suggestions', () => {
    const place: GooglePlaceReference = {
      displayName: undefined,
      fetchFields: vi.fn<GooglePlaceReference['fetchFields']>(),
      formattedAddress: undefined,
      id: 'place-1',
      location: undefined,
    };

    expect(
      decodeLocationSuggestions({
        suggestions: [
          {
            placePrediction: {
              mainText: { text: ' Berlin ' },
              placeId: ' place-1 ',
              secondaryText: { text: ' Germany ' },
              toPlace: () => place,
            },
          },
        ],
      }),
    ).toEqual([
      {
        mainText: 'Berlin',
        place,
        placeId: 'place-1',
        secondaryText: 'Germany',
      },
    ]);

    for (const malformed of [
      {},
      { suggestions: null },
      { suggestions: [{}] },
      { suggestions: [{ placePrediction: {} }] },
      {
        suggestions: [
          {
            placePrediction: {
              mainText: { text: 'Berlin' },
              placeId: 'place-1',
              toPlace: () => ({}),
            },
          },
        ],
      },
    ]) {
      expect(() => decodeLocationSuggestions(malformed)).toThrow(TypeError);
    }
  });
});
