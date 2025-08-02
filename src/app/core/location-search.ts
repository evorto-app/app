import { Injectable } from '@angular/core';
import { Loader } from '@googlemaps/js-api-loader';

import { GoogleLocation } from '../../shared/types/location';

const loader = new Loader({
  apiKey: 'AIzaSyAMfVVwWv-3eVdU3uU54ygI_7jCNSzRXlo',
  version: 'weekly',
});

@Injectable({
  providedIn: 'root',
})
export class LocationSearch {
  private _autocompleteService?: typeof google.maps.places.AutocompleteSuggestion;
  private _sessionToken?: google.maps.places.AutocompleteSessionToken;
  async getPlaceDetails(
    place: google.maps.places.Place,
  ): Promise<GoogleLocation> {
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
  ): Promise<google.maps.places.AutocompleteSuggestion[]> {
    const { service, token } = await this.initAutocomplete();
    return service
      .fetchAutocompleteSuggestions({
        input: query,
        sessionToken: token,
      })
      .then((result) => result.suggestions ?? []);
  }

  private async initAutocomplete(): Promise<{
    service: typeof google.maps.places.AutocompleteSuggestion;
    token: google.maps.places.AutocompleteSessionToken;
  }> {
    if (!this._autocompleteService || !this._sessionToken) {
      const { AutocompleteSessionToken, AutocompleteSuggestion } =
        await loader.importLibrary('places');
      this._autocompleteService = AutocompleteSuggestion;
      this._sessionToken = new AutocompleteSessionToken();
    }
    return {
      service: this._autocompleteService,
      token: this._sessionToken,
    };
  }
}
