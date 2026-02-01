import { AsyncPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { debounce, form, FormField } from '@angular/forms/signals';
import {
  MatAutocompleteModule,
  MatAutocompleteSelectedEvent,
} from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import consola from 'consola/browser';
import { catchError, from, of, switchMap } from 'rxjs';

import { ConfigService } from '../../../../../core/config.service';
import { LocationSearch } from '../../../../../core/location-search';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatAutocompleteModule,
    AsyncPipe,
    FormField,
  ],
  selector: 'app-location-selector-dialog',
  styles: ``,
  templateUrl: './location-selector-dialog.html',
})
export class LocationSelectorDialog {
  private readonly searchModel = signal<{
    query: string | google.maps.places.AutocompleteSuggestion;
  }>({ query: '' });
  protected readonly searchForm = form(this.searchModel, (schema) => {
    debounce(schema, 300);
  });
  private readonly configService = inject(ConfigService);

  private readonly locationSearch = inject(LocationSearch);

  protected locationOptions$ = toObservable(this.searchForm.query().value).pipe(
    // Use switchMap to handle the asynchronous search
    switchMap((query) => {
      if (!query) {
        return of([]); // Return an empty array if the query is empty
      }
      if (typeof query !== 'string') {
        consola.warn('Query is not a string:', query);
        return of([]); // Handle non-string queries gracefully
      }

      // Get tenant's default location for search bias from config service
      const defaultLocation = this.configService.tenant?.defaultLocation;

      return from(this.locationSearch.search(query, defaultLocation)).pipe(
        catchError(() => of([])), // Handle errors gracefully
      );
    }),
  );

  private readonly dialog = inject(MatDialogRef<LocationSelectorDialog>);

  async selectOption(event: MatAutocompleteSelectedEvent) {
    const location = event.option
      .value as google.maps.places.AutocompleteSuggestion;
    const place = location.placePrediction?.toPlace();
    if (place) {
      const googleLocation = await this.locationSearch.getPlaceDetails(place);
      this.dialog.close(googleLocation);
    }
  }

  protected readonly displayFunction = (
    location: google.maps.places.AutocompletePrediction,
  ) => {
    return location?.structured_formatting?.main_text;
  };
}
