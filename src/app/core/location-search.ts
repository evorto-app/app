import { inject, Injectable, InjectionToken } from '@angular/core';
import { importLibrary, setOptions } from '@googlemaps/js-api-loader';
import consola from 'consola/browser';
import { Effect, Schema } from 'effect';

import { GoogleLocationType } from '../../types/location';
import { ConfigService } from './config.service';

export type GooglePlaceReference = Pick<
  google.maps.places.Place,
  'displayName' | 'fetchFields' | 'formattedAddress' | 'id' | 'location'
>;

export type LocationSearchError =
  LocationConfigurationError | LocationProviderError;

export interface LocationSuggestion {
  readonly mainText: string;
  readonly place: GooglePlaceReference;
  readonly placeId: string;
  readonly secondaryText?: string;
}

type GoogleMapsLibrary = Awaited<ReturnType<typeof importLibrary>>;

interface GoogleMapsLoader {
  readonly importLibrary: typeof importLibrary;
  readonly setOptions: typeof setOptions;
}

const LocationProviderOperation = Schema.Literals([
  'initialize',
  'placeDetails',
  'search',
]);

export class LocationConfigurationError extends Schema.TaggedErrorClass<LocationConfigurationError>()(
  'LocationConfigurationError',
  {
    setting: Schema.Literal('PUBLIC_GOOGLE_MAPS_API_KEY'),
  },
) {}

export class LocationProviderError extends Schema.TaggedErrorClass<LocationProviderError>()(
  'LocationProviderError',
  {
    cause: Schema.Defect(),
    operation: LocationProviderOperation,
  },
) {}

export const GOOGLE_MAPS_LOADER = new InjectionToken<GoogleMapsLoader>(
  'GoogleMapsLoader',
  {
    factory: () => ({ importLibrary, setOptions }),
    providedIn: 'root',
  },
);

const isPlacesLibrary = (
  library: GoogleMapsLibrary,
): library is google.maps.PlacesLibrary =>
  'AutocompleteSuggestion' in library && 'AutocompleteSessionToken' in library;

const makeLocationSearchOperations = (
  config: ConfigService,
  loader: GoogleMapsLoader,
) => {
  let autocompleteService:
    typeof google.maps.places.AutocompleteSuggestion | undefined;
  let sessionToken: google.maps.places.AutocompleteSessionToken | undefined;
  let optionsSet = false;

  const getPlaceDetails = Effect.fn('LocationSearch.getPlaceDetails')(
    function* (
      place: GooglePlaceReference,
    ): Effect.fn.Return<GoogleLocationType, LocationProviderError> {
      yield* Effect.tryPromise({
        catch: (cause) =>
          new LocationProviderError({ cause, operation: 'placeDetails' }),
        try: () =>
          place.fetchFields({
            fields: ['displayName', 'formattedAddress', 'location'],
          }),
      });

      return yield* Effect.try({
        catch: (cause) =>
          new LocationProviderError({ cause, operation: 'placeDetails' }),
        try: () => {
          const location = place.location;
          const name = place.displayName?.trim();
          if (!location || !name || !place.id) {
            throw new TypeError(
              'Google Maps returned incomplete location details',
            );
          }

          const lat = location.lat();
          const lng = location.lng();
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
            throw new TypeError('Google Maps returned invalid coordinates');
          }

          const address = place.formattedAddress?.trim();
          const type: GoogleLocationType['type'] = 'google';
          return {
            ...(address && { address }),
            coordinates: { lat, lng },
            name,
            placeId: place.id,
            type,
          };
        },
      });
    },
  );

  const initAutocomplete = Effect.fn('LocationSearch.initAutocomplete')(
    function* (): Effect.fn.Return<
      {
        service: typeof google.maps.places.AutocompleteSuggestion;
        token: google.maps.places.AutocompleteSessionToken;
      },
      LocationSearchError
    > {
      const mapsApiKey = config.publicConfig.googleMapsApiKey?.trim();
      if (!mapsApiKey) {
        return yield* new LocationConfigurationError({
          setting: 'PUBLIC_GOOGLE_MAPS_API_KEY',
        });
      }

      if (!optionsSet) {
        yield* Effect.try({
          catch: (cause) =>
            new LocationProviderError({ cause, operation: 'initialize' }),
          try: () =>
            loader.setOptions({
              key: mapsApiKey,
              v: 'weekly',
            }),
        });
        consola.debug('Google Maps loader initialized');
        optionsSet = true;
      }

      if (!autocompleteService || !sessionToken) {
        const library = yield* Effect.tryPromise({
          catch: (cause) =>
            new LocationProviderError({ cause, operation: 'initialize' }),
          try: () => loader.importLibrary('places'),
        });
        if (!isPlacesLibrary(library)) {
          return yield* new LocationProviderError({
            cause: new TypeError('Google Maps Places library failed to load'),
            operation: 'initialize',
          });
        }

        const initialized = yield* Effect.try({
          catch: (cause) =>
            new LocationProviderError({ cause, operation: 'initialize' }),
          try: () => ({
            service: library.AutocompleteSuggestion,
            token: new library.AutocompleteSessionToken(),
          }),
        });
        autocompleteService = initialized.service;
        sessionToken = initialized.token;
      }

      const service = autocompleteService;
      const token = sessionToken;
      if (!service || !token) {
        return yield* new LocationProviderError({
          cause: new TypeError(
            'Google Maps autocomplete service was not initialized',
          ),
          operation: 'initialize',
        });
      }

      return { service, token };
    },
  );

  const search = Effect.fn('LocationSearch.search')(function* (
    query: string,
    defaultLocation?: GoogleLocationType,
  ): Effect.fn.Return<LocationSuggestion[], LocationSearchError> {
    const { service, token } = yield* initAutocomplete();

    const request: google.maps.places.AutocompleteRequest = {
      input: query,
      sessionToken: token,
      ...(defaultLocation && {
        locationBias: {
          center: defaultLocation.coordinates,
          radius: 50_000,
        },
      }),
    };

    const result = yield* Effect.tryPromise({
      catch: (cause) =>
        new LocationProviderError({ cause, operation: 'search' }),
      try: () => service.fetchAutocompleteSuggestions(request),
    });

    return yield* Effect.try({
      catch: (cause) =>
        new LocationProviderError({ cause, operation: 'search' }),
      try: () =>
        (result.suggestions ?? []).flatMap((suggestion) => {
          const prediction = suggestion.placePrediction;
          if (!prediction) return [];

          const mainText = prediction.mainText?.text.trim();
          if (!mainText) return [];

          const secondaryText = prediction.secondaryText?.text.trim();
          return [
            {
              mainText,
              place: prediction.toPlace(),
              placeId: prediction.placeId,
              ...(secondaryText && { secondaryText }),
            },
          ];
        }),
    });
  });

  return { getPlaceDetails, search };
};

type LocationSearchOperations = ReturnType<typeof makeLocationSearchOperations>;

@Injectable({
  providedIn: 'root',
})
export class LocationSearch {
  readonly getPlaceDetails: LocationSearchOperations['getPlaceDetails'];
  readonly search: LocationSearchOperations['search'];

  constructor() {
    const operations = makeLocationSearchOperations(
      inject(ConfigService),
      inject(GOOGLE_MAPS_LOADER),
    );
    this.getPlaceDetails = operations.getPlaceDetails;
    this.search = operations.search;
  }
}
