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

export type LocationSearchError = LocationProviderError;

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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isGooglePlaceReference = (
  value: unknown,
): value is GooglePlaceReference => {
  if (!isRecord(value)) return false;

  return (
    typeof value['fetchFields'] === 'function' &&
    typeof value['id'] === 'string'
  );
};

export const decodeLocationSuggestions = (
  result: unknown,
): LocationSuggestion[] => {
  if (!isRecord(result) || !Array.isArray(result['suggestions'])) {
    throw new TypeError(
      'Google Maps returned an invalid location suggestion list',
    );
  }

  return result['suggestions'].map((suggestion, index) => {
    if (!isRecord(suggestion) || !isRecord(suggestion['placePrediction'])) {
      throw new TypeError(
        `Google Maps location suggestion ${index + 1} has no place`,
      );
    }

    const prediction = suggestion['placePrediction'];
    const mainTextValue = prediction['mainText'];
    const placeIdValue = prediction['placeId'];
    const toPlace = prediction['toPlace'];
    if (
      !isRecord(mainTextValue) ||
      typeof mainTextValue['text'] !== 'string' ||
      typeof placeIdValue !== 'string' ||
      typeof toPlace !== 'function'
    ) {
      throw new TypeError(
        `Google Maps location suggestion ${index + 1} is incomplete`,
      );
    }

    const mainText = mainTextValue['text'].trim();
    const placeId = placeIdValue.trim();
    if (!mainText || !placeId) {
      throw new TypeError(
        `Google Maps location suggestion ${index + 1} is incomplete`,
      );
    }

    const secondaryTextValue = prediction['secondaryText'];
    let secondaryText = '';
    if (secondaryTextValue !== null && secondaryTextValue !== undefined) {
      if (
        !isRecord(secondaryTextValue) ||
        typeof secondaryTextValue['text'] !== 'string'
      ) {
        throw new TypeError(
          `Google Maps location suggestion ${index + 1} is incomplete`,
        );
      }
      secondaryText = secondaryTextValue['text'].trim();
    }

    const place: unknown = toPlace.call(prediction);
    if (!isGooglePlaceReference(place)) {
      throw new TypeError(
        `Google Maps location suggestion ${index + 1} has invalid details`,
      );
    }

    return {
      mainText,
      place,
      placeId,
      ...(secondaryText && { secondaryText }),
    };
  });
};

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
      const mapsApiKey = config.publicConfig.googleMapsApiKey;

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
      try: () => decodeLocationSuggestions(result),
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
