import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  MatAutocomplete,
  MatAutocompleteSelectedEvent,
  MatOption,
} from '@angular/material/autocomplete';
import { MatDialogRef } from '@angular/material/dialog';
import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GoogleLocationType } from '../../../../../../types/location';
import { ConfigService } from '../../../../../core/config.service';
import {
  GooglePlaceReference,
  LocationConfigurationError,
  LocationProviderError,
  LocationSearch,
  LocationSearchError,
  LocationSuggestion,
} from '../../../../../core/location-search';
import { LocationSelectorDialog } from './location-selector-dialog';

describe('LocationSelectorDialog', () => {
  const search = vi.fn<LocationSearch['search']>();
  const getPlaceDetails = vi.fn<LocationSearch['getPlaceDetails']>();
  const close = vi.fn<MatDialogRef<LocationSelectorDialog>['close']>();
  let searchEffect: Effect.Effect<LocationSuggestion[], LocationSearchError>;
  let placeDetailsEffect: Effect.Effect<
    GoogleLocationType,
    LocationProviderError
  >;
  let fixture: ComponentFixture<LocationSelectorDialog>;

  beforeEach(async () => {
    searchEffect = Effect.succeed([]);
    placeDetailsEffect = Effect.die('Place details were not configured');
    search.mockReset();
    search.mockImplementation(() => searchEffect);
    getPlaceDetails.mockReset();
    getPlaceDetails.mockImplementation(() => placeDetailsEffect);
    close.mockReset();

    await TestBed.configureTestingModule({
      imports: [LocationSelectorDialog],
      providers: [
        {
          provide: ConfigService,
          useValue: { tenant: { defaultLocation: undefined } },
        },
        {
          provide: LocationSearch,
          useValue: { getPlaceDetails, search },
        },
        { provide: MatDialogRef, useValue: { close } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LocationSelectorDialog);
    fixture.detectChanges();
  });

  it('shows a real empty state only after a successful search', async () => {
    await enterQuery('No Such Place');

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain(
        'No locations found. Check the spelling or try a broader search.',
      );
    });
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
  });

  it('explains missing provider configuration instead of showing no results', async () => {
    searchEffect = Effect.fail(
      new LocationConfigurationError({
        setting: 'PUBLIC_GOOGLE_MAPS_API_KEY',
      }),
    );

    await enterQuery('Berlin');

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain(
        'Location search is not configured for this site.',
      );
    });
    expect(fixture.nativeElement.textContent).toContain(
      'A site administrator needs to configure the Google Maps API key',
    );
    expect(fixture.nativeElement.textContent).not.toContain(
      'No locations found',
    );
    expect(
      fixture.nativeElement.querySelector('[role="alert"]'),
    ).not.toBeNull();
  });

  it('shows provider failure and retries the same search', async () => {
    searchEffect = Effect.fail(
      new LocationProviderError({
        cause: new Error('provider unavailable'),
        operation: 'search',
      }),
    );

    await enterQuery('Berlin');
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain(
        'The location provider is unavailable right now.',
      );
    });

    searchEffect = Effect.succeed([]);
    const retryButton = findButton('Retry location search');
    retryButton.click();

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(search).toHaveBeenCalledTimes(2);
      expect(fixture.nativeElement.textContent).toContain(
        'No locations found.',
      );
    });
  });

  it('announces the loading state while a provider request is pending', async () => {
    let resolveSearch:
      ((suggestions: LocationSuggestion[]) => void) | undefined;
    // eslint-disable-next-line unicorn/prefer-promise-with-resolvers -- the project TypeScript lib intentionally remains below ES2024
    const pendingSearch = new Promise<LocationSuggestion[]>((resolve) => {
      resolveSearch = resolve;
    });
    searchEffect = Effect.promise(() => pendingSearch);

    await enterQuery('Berlin');

    expect(fixture.nativeElement.textContent).toContain('Searching locations…');
    expect(
      fixture.nativeElement
        .querySelector('[aria-busy]')
        ?.getAttribute('aria-busy'),
    ).toBe('true');

    resolveSearch?.([]);
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain(
        'No locations found.',
      );
    });
  });

  it('shows and retries a place-detail failure without closing the dialog', async () => {
    const suggestion = makeSuggestion();
    placeDetailsEffect = Effect.fail(
      new LocationProviderError({
        cause: new Error('details unavailable'),
        operation: 'placeDetails',
      }),
    );
    const autocomplete = TestBed.createComponent(MatAutocomplete);
    const option = TestBed.createComponent(MatOption);
    option.componentInstance.value = suggestion;

    await fixture.componentInstance.selectOption(
      new MatAutocompleteSelectedEvent(
        autocomplete.componentInstance,
        option.componentInstance,
      ),
    );
    fixture.detectChanges();

    expect(close).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain(
      'The location provider could not load this place.',
    );

    const location: GoogleLocationType = {
      address: 'Alexanderplatz, Berlin',
      coordinates: { lat: 52.5219, lng: 13.4132 },
      name: 'Alexanderplatz',
      placeId: 'place-1',
      type: 'google',
    };
    placeDetailsEffect = Effect.succeed(location);
    findButton('Retry location details').click();

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(getPlaceDetails).toHaveBeenCalledTimes(2);
      expect(close).toHaveBeenCalledWith(location);
    });
  });

  async function enterQuery(query: string): Promise<void> {
    const input: HTMLInputElement | null =
      fixture.nativeElement.querySelector('input');
    if (!input) throw new Error('Location input was not rendered');

    input.value = query;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(search).toHaveBeenCalled();
    });
  }

  function findButton(label: string): HTMLButtonElement {
    const buttons: NodeListOf<HTMLButtonElement> =
      fixture.nativeElement.querySelectorAll('button');
    const button = [...buttons].find(
      (candidate) => candidate.textContent?.trim() === label,
    );
    if (!button) throw new Error(`Button not found: ${label}`);
    return button;
  }

  function makeSuggestion(): LocationSuggestion {
    const place: GooglePlaceReference = {
      displayName: null,
      fetchFields: vi.fn<GooglePlaceReference['fetchFields']>(),
      formattedAddress: null,
      id: 'place-1',
      location: null,
    };
    return {
      mainText: 'Alexanderplatz',
      place,
      placeId: 'place-1',
      secondaryText: 'Berlin, Germany',
    };
  }
});
