import { AsyncPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import {
  MatAutocompleteModule,
  MatAutocompleteSelectedEvent,
} from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import consola from 'consola/browser';
import { catchError, debounceTime, from, of, switchMap, tap } from 'rxjs';

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
    ReactiveFormsModule,
  ],
  selector: 'app-location-selector-dialog',
  styles: ``,
  templateUrl: './location-selector-dialog.html',
})
export class LocationSelectorDialog {
  protected locationControl = new FormControl();
  private readonly configService = inject(ConfigService);

  private readonly locationSearch = inject(LocationSearch);

  protected locationOptions$ = this.locationControl.valueChanges.pipe(
    debounceTime(300), // Debounce input to reduce API calls
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
    const location = event.option.value as google.maps.places.AutocompleteSuggestion;
    const place = location.placePrediction?.toPlace();
    if (place) {
      const googleLocation = await this.locationSearch.getPlaceDetails(place);
      this.dialog.close(googleLocation);
    }
  }

  protected readonly displayFunction = (location: google.maps.places.AutocompletePrediction) => {
    return location?.structured_formatting?.main_text;
  };
}
