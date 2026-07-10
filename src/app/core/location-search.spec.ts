import { TestBed } from '@angular/core/testing';
import { assert, beforeEach, describe, it, vi } from '@effect/vitest';
import {
  importLibrary as googleMapsImportLibrary,
  setOptions as googleMapsSetOptions,
} from '@googlemaps/js-api-loader';
import { Effect } from 'effect';

import { ConfigService } from './config.service';
import {
  GOOGLE_MAPS_LOADER,
  GooglePlaceReference,
  LocationConfigurationError,
  LocationProviderError,
  LocationSearch,
} from './location-search';

describe('LocationSearch', () => {
  const config: {
    publicConfig: { googleMapsApiKey: null | string };
  } = {
    publicConfig: {
      googleMapsApiKey: null,
    },
  };
  const loader = {
    importLibrary: vi.fn<typeof googleMapsImportLibrary>(),
    setOptions: vi.fn<typeof googleMapsSetOptions>(),
  };
  let locationSearch: LocationSearch;

  beforeEach(() => {
    config.publicConfig.googleMapsApiKey = null;
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

  it.effect('returns a typed configuration failure before loading Maps', () =>
    Effect.gen(function* () {
      const failure = yield* locationSearch.search('Berlin').pipe(Effect.flip);

      assert.instanceOf(failure, LocationConfigurationError);
      assert.strictEqual(failure.setting, 'PUBLIC_GOOGLE_MAPS_API_KEY');
      assert.strictEqual(loader.setOptions.mock.calls.length, 0);
      assert.strictEqual(loader.importLibrary.mock.calls.length, 0);
    }),
  );

  it.effect('preserves the provider cause when the Places library fails', () =>
    Effect.gen(function* () {
      const providerCause = new Error('provider unavailable');
      config.publicConfig.googleMapsApiKey = 'maps-key';
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
});
