import { AsyncPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
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
import { MatProgressBarModule } from '@angular/material/progress-bar';
import consola from 'consola/browser';
import { Effect } from 'effect';
import {
  catchError,
  combineLatest,
  from,
  of,
  shareReplay,
  startWith,
  switchMap,
} from 'rxjs';

import { GoogleLocationType } from '../../../../../../types/location';
import { ConfigService } from '../../../../../core/config.service';
import {
  LocationConfigurationError,
  LocationProviderError,
  LocationSearch,
  LocationSearchError,
  LocationSuggestion,
} from '../../../../../core/location-search';

type LocationSearchState =
  | {
      readonly failure: LocationConfigurationError;
      readonly status: 'configuration-error';
    }
  | {
      readonly failure: LocationProviderError;
      readonly status: 'provider-error';
    }
  | {
      readonly options: LocationSuggestion[];
      readonly status: 'results';
    }
  | { readonly status: 'empty' }
  | { readonly status: 'idle' }
  | { readonly status: 'loading' };

type PlaceDetailsOutcome =
  | {
      readonly failure: LocationProviderError;
      readonly status: 'failure';
    }
  | {
      readonly location: GoogleLocationType;
      readonly status: 'success';
    };

type PlaceSelectionState =
  | {
      readonly failure: LocationProviderError;
      readonly status: 'provider-error';
    }
  | { readonly status: 'idle' }
  | { readonly status: 'loading' };

const isLocationSuggestion = (value: unknown): value is LocationSuggestion =>
  typeof value === 'object' &&
  value !== null &&
  'mainText' in value &&
  typeof value.mainText === 'string' &&
  'placeId' in value &&
  typeof value.placeId === 'string' &&
  'place' in value &&
  typeof value.place === 'object' &&
  value.place !== null;

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatAutocompleteModule,
    MatProgressBarModule,
    AsyncPipe,
    FormField,
  ],
  selector: 'app-location-selector-dialog',
  styles: ``,
  templateUrl: './location-selector-dialog.html',
})
export class LocationSelectorDialog {
  private readonly searchModel = signal<{
    query: LocationSuggestion | string;
  }>({ query: '' });
  protected readonly searchForm = form(this.searchModel, (schema) => {
    debounce(schema, 300);
  });
  private readonly configService = inject(ConfigService);
  private readonly locationSearch = inject(LocationSearch);
  private readonly searchRetry = signal(0);

  protected readonly locationSearchState$ = combineLatest([
    toObservable(this.searchForm.query().value),
    toObservable(this.searchRetry),
  ]).pipe(
    switchMap(([query]) => {
      if (!query || typeof query !== 'string') {
        return of<LocationSearchState>({ status: 'idle' });
      }

      const defaultLocation = this.configService.tenant?.defaultLocation;
      const search = this.locationSearch.search(query, defaultLocation).pipe(
        Effect.match({
          onFailure: (failure): LocationSearchState =>
            this.failedSearchState(failure),
          onSuccess: (options): LocationSearchState =>
            options.length === 0
              ? { status: 'empty' }
              : { options, status: 'results' },
        }),
      );

      // Angular/RxJS is the explicit runtime boundary for this browser Effect.
      // eslint-disable-next-line effect-boundaries/no-run-at-internal-boundaries
      return from(Effect.runPromise(search)).pipe(
        startWith<LocationSearchState>({ status: 'loading' }),
        catchError((cause: unknown) => {
          const failure = new LocationProviderError({
            cause,
            operation: 'search',
          });
          return of<LocationSearchState>(this.failedSearchState(failure));
        }),
      );
    }),
    shareReplay({ bufferSize: 1, refCount: true }),
  );
  protected readonly selectionState = signal<PlaceSelectionState>({
    status: 'idle',
  });
  private readonly dialog = inject(MatDialogRef<LocationSelectorDialog>);

  private readonly pendingSuggestion = signal<LocationSuggestion | null>(null);

  async selectOption(event: MatAutocompleteSelectedEvent): Promise<void> {
    const value: unknown = event.option.value;
    if (!isLocationSuggestion(value)) {
      consola.warn('Ignoring an invalid location search result');
      return;
    }

    await this.loadPlaceDetails(value);
  }

  protected readonly displayFunction = (
    location: LocationSuggestion | null | string,
  ): string =>
    typeof location === 'string' ? location : (location?.mainText ?? '');

  protected async retryPlaceDetails(): Promise<void> {
    const suggestion = this.pendingSuggestion();
    if (suggestion) {
      await this.loadPlaceDetails(suggestion);
    }
  }

  protected retrySearch(): void {
    this.searchRetry.update((attempt) => attempt + 1);
  }

  private failedSearchState(failure: LocationSearchError): LocationSearchState {
    if (failure._tag === 'LocationConfigurationError') {
      consola.error('Location search is not configured', failure);
      return { failure, status: 'configuration-error' };
    }

    consola.error('Location provider search failed', failure);
    return { failure, status: 'provider-error' };
  }

  private async loadPlaceDetails(
    suggestion: LocationSuggestion,
  ): Promise<void> {
    this.pendingSuggestion.set(suggestion);
    this.selectionState.set({ status: 'loading' });

    let outcome: PlaceDetailsOutcome;
    try {
      // Angular is the explicit runtime boundary for this browser Effect.
      // eslint-disable-next-line effect-boundaries/no-run-at-internal-boundaries
      outcome = await Effect.runPromise(
        this.locationSearch.getPlaceDetails(suggestion.place).pipe(
          Effect.match({
            onFailure: (failure): PlaceDetailsOutcome => ({
              failure,
              status: 'failure',
            }),
            onSuccess: (location): PlaceDetailsOutcome => ({
              location,
              status: 'success',
            }),
          }),
        ),
      );
    } catch (error: unknown) {
      outcome = {
        failure: new LocationProviderError({
          cause: error,
          operation: 'placeDetails',
        }),
        status: 'failure',
      };
    }

    if (outcome.status === 'success') {
      this.dialog.close(outcome.location);
      return;
    }

    consola.error('Location provider place details failed', outcome.failure);
    this.selectionState.set({
      failure: outcome.failure,
      status: 'provider-error',
    });
  }
}
