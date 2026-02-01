import { inject, Injectable } from '@angular/core';
import { importLibrary, Loader, setOptions } from '@googlemaps/js-api-loader';

import { GoogleLocationType } from '../../types/location';
import { ConfigService } from './config.service';

type GoogleMapsLibrary = Awaited<ReturnType<typeof google.maps.importLibrary>>;

const isPlacesLibrary = (
  library: GoogleMapsLibrary,
): library is google.maps.PlacesLibrary =>
  'AutocompleteSuggestion' in library && 'AutocompleteSessionToken' in library;

@Injectable({
  providedIn: 'root',
})
export class LocationSearch {
  private _autocompleteService?: typeof google.maps.places.AutocompleteSuggestion;
  private _sessionToken?: google.maps.places.AutocompleteSessionToken;
  private readonly config = inject(ConfigService);
  private loader?: Loader;
  async getPlaceDetails(
    place: google.maps.places.Place,
  ): Promise<GoogleLocationType> {
    await place.fetchFields({
      fields: ['displayName', 'formattedAddress', 'location'],
    });
    return {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      address: place.formattedAddress!,
      coordinates: {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        lat: place.location!.lat(),
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        lng: place.location!.lng(),
      },
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      name: place.displayName!,
      placeId: place.id,
      type: 'google',
    };
  }

  async search(
    query: string,
    defaultLocation?: GoogleLocationType | undefined,
  ): Promise<google.maps.places.AutocompleteSuggestion[]> {
    const { service, token } = await this.initAutocomplete();

    const request: google.maps.places.AutocompleteRequest = {
      input: query,
      sessionToken: token,
    };

    // Use default location for bias if provided
    if (defaultLocation) {
      request.locationBias = {
        center: new google.maps.LatLng(
          defaultLocation.coordinates.lat,
          defaultLocation.coordinates.lng,
        ),
        radius: 50_000, // 50km radius
      };
    }

    return service
      .fetchAutocompleteSuggestions(request)
      .then((result) => result.suggestions ?? []);
  }

  private async initAutocomplete(): Promise<{
    service: typeof google.maps.places.AutocompleteSuggestion;
    token: google.maps.places.AutocompleteSessionToken;
  }> {
    if (!this.loader) {
      this.loader = new Loader();
      setOptions({
        key: this.config.publicConfig.googleMapsApiKey ?? '',
        v: 'weekly',
      });
    }
    if (!this._autocompleteService || !this._sessionToken) {
      const library = await importLibrary('places');
      if (!isPlacesLibrary(library)) {
        throw new Error('Google Maps Places library failed to load');
      }
      this._autocompleteService = library.AutocompleteSuggestion;
      this._sessionToken = new library.AutocompleteSessionToken();
    }
    if (!this._autocompleteService || !this._sessionToken) {
      throw new Error('Google Maps autocomplete service not initialized');
    }
    return {
      service: this._autocompleteService,
      token: this._sessionToken,
    };
  }
}
