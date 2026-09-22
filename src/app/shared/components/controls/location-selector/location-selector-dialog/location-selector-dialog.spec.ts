import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  MatAutocomplete,
  MatAutocompleteSelectedEvent,
  MatOption,
} from '@angular/material/autocomplete';
import { MatDialogRef, MatDialogState } from '@angular/material/dialog';
import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GoogleLocationType } from '../../../../../../types/location';
import { ConfigService } from '../../../../../core/config.service';
import {
  GooglePlaceReference,
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
  const getState = vi.fn<MatDialogRef<LocationSelectorDialog>['getState']>();
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
    getState.mockReset().mockReturnValue(MatDialogState.OPEN);

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
        { provide: MatDialogRef, useValue: { close, getState } },
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

  it('keeps the typed query visible while provider search is debounced', async () => {
    const input: HTMLInputElement | null =
      fixture.nativeElement.querySelector('input');
    if (!input) throw new Error('Location input was not rendered');

    input.value = 'Berlin';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();

    expect(input.value).toBe('Berlin');
    expect(search).not.toHaveBeenCalled();

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(search).toHaveBeenCalledWith('Berlin', undefined);
    });
    expect(input.value).toBe('Berlin');
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
        "We couldn't search for locations.",
      );
      expect(fixture.nativeElement.textContent).toContain(
        'If the search still fails, contact Evorto support.',
      );
    });

    searchEffect = Effect.succeed([]);
    const retryButton = findButton('Try location search again');
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
      "We couldn't load this location.",
    );
    expect(fixture.nativeElement.textContent).toContain(
      'If neither works, contact Evorto support.',
    );

    const location: GoogleLocationType = {
      address: 'Alexanderplatz, Berlin',
      coordinates: { lat: 52.5219, lng: 13.4132 },
      name: 'Alexanderplatz',
      placeId: 'place-1',
      type: 'google',
    };
    placeDetailsEffect = Effect.succeed(location);
    findButton('Try this location again').click();

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(getPlaceDetails).toHaveBeenCalledTimes(2);
      expect(close).toHaveBeenCalledWith(location);
    });
  });

  it.each(['success', 'failure'])(
    'keeps the newer selection loading after an older %s',
    async (olderOutcome) => {
      const older = pendingDetails();
      const newer = pendingDetails();
      getPlaceDetails
        .mockReturnValueOnce(older.effect)
        .mockReturnValueOnce(newer.effect);
      const olderRequest = selectSuggestion(makeSuggestion('place-1'));
      const newerRequest = selectSuggestion(makeSuggestion('place-2'));

      if (olderOutcome === 'success') older.succeed(makeLocation('place-1'));
      else older.fail();
      await olderRequest;
      fixture.detectChanges();

      expect(close).not.toHaveBeenCalled();
      expect(fixture.nativeElement.textContent).toContain('Loading location…');
      expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();

      const newerLocation = makeLocation('place-2');
      newer.succeed(newerLocation);
      await newerRequest;
      expect(close).toHaveBeenCalledExactlyOnceWith(newerLocation);
    },
  );

  it('preserves a newer failure and retries that selection after an older success', async () => {
    const older = pendingDetails();
    const newer = pendingDetails();
    const newerSuggestion = makeSuggestion('place-2');
    getPlaceDetails
      .mockReturnValueOnce(older.effect)
      .mockReturnValueOnce(newer.effect);
    const olderRequest = selectSuggestion(makeSuggestion('place-1'));
    const newerRequest = selectSuggestion(newerSuggestion);

    newer.fail();
    await newerRequest;
    older.succeed(makeLocation('place-1'));
    await olderRequest;
    fixture.detectChanges();

    expect(close).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain(
      "We couldn't load this location.",
    );
    const newerLocation = makeLocation('place-2');
    getPlaceDetails.mockReturnValueOnce(Effect.succeed(newerLocation));
    findButton('Try this location again').click();

    await vi.waitFor(() => {
      expect(getPlaceDetails).toHaveBeenLastCalledWith(newerSuggestion.place);
      expect(close).toHaveBeenCalledExactlyOnceWith(newerLocation);
    });
  });

  it('ignores pending place details when the user starts a different search', async () => {
    const pendingSelection = pendingDetails();
    getPlaceDetails.mockReturnValueOnce(pendingSelection.effect);
    const selection = selectSuggestion(makeSuggestion());
    const input: HTMLInputElement | null =
      fixture.nativeElement.querySelector('input');
    if (!input) throw new Error('Location input was not rendered');
    input.value = 'A different location';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    pendingSelection.succeed(makeLocation('place-1'));
    await selection;
    fixture.detectChanges();

    expect(close).not.toHaveBeenCalled();
    expect(input.value).toBe('A different location');
    expect(fixture.nativeElement.textContent).not.toContain(
      'Loading location…',
    );
    expect(fixture.nativeElement.textContent).not.toContain(
      'Try this location again',
    );
  });

  it('preserves an invalid newer selection after older place details finish', async () => {
    const pendingSelection = pendingDetails();
    getPlaceDetails.mockReturnValueOnce(pendingSelection.effect);
    const selection = selectSuggestion(makeSuggestion());
    await selectSuggestion({ placeId: 'invalid' });
    pendingSelection.succeed(makeLocation('place-1'));
    await selection;
    fixture.detectChanges();

    expect(close).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain(
      "We couldn't use this location result.",
    );
  });

  it('preserves cancellation while the dialog exit animation is running', async () => {
    const pendingSelection = pendingDetails();
    getPlaceDetails.mockReturnValueOnce(pendingSelection.effect);
    const selection = selectSuggestion(makeSuggestion());
    getState.mockReturnValue(MatDialogState.CLOSING);
    pendingSelection.succeed(makeLocation('place-1'));
    await selection;

    expect(close).not.toHaveBeenCalled();
  });

  it('does not commit place details after the dialog is destroyed', async () => {
    const pendingSelection = pendingDetails();
    getPlaceDetails.mockReturnValueOnce(pendingSelection.effect);
    const selection = selectSuggestion(makeSuggestion());
    fixture.destroy();
    pendingSelection.succeed(makeLocation('place-1'));
    await selection;

    expect(close).not.toHaveBeenCalled();
  });

  it('shows an explicit failure for an invalid provider result', async () => {
    const autocomplete = TestBed.createComponent(MatAutocomplete);
    const option = TestBed.createComponent(MatOption);
    option.componentInstance.value = { placeId: 'incomplete' };

    await fixture.componentInstance.selectOption(
      new MatAutocompleteSelectedEvent(
        autocomplete.componentInstance,
        option.componentInstance,
      ),
    );
    fixture.detectChanges();

    expect(getPlaceDetails).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain(
      "We couldn't use this location result.",
    );
    expect(fixture.nativeElement.textContent).toContain(
      'Choose another result.',
    );
    expect(
      fixture.nativeElement.querySelector('[role="alert"]'),
    ).not.toBeNull();
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

  function makeLocation(placeId: string): GoogleLocationType {
    return {
      address: 'Berlin',
      coordinates: { lat: 52.5219, lng: 13.4132 },
      name: placeId,
      placeId,
      type: 'google',
    };
  }

  function pendingDetails() {
    let resolveDetails: ((location: GoogleLocationType) => void) | undefined;
    let rejectDetails: ((reason: Error) => void) | undefined;
    // eslint-disable-next-line unicorn/prefer-promise-with-resolvers -- the project TypeScript lib intentionally remains below ES2024
    const promise = new Promise<GoogleLocationType>((resolve, reject) => {
      resolveDetails = resolve;
      rejectDetails = reject;
    });
    return {
      effect: Effect.tryPromise({
        catch: (cause) =>
          new LocationProviderError({ cause, operation: 'placeDetails' }),
        try: () => promise,
      }),
      fail: () => rejectDetails?.(new Error('details unavailable')),
      succeed: (location: GoogleLocationType) => resolveDetails?.(location),
    };
  }

  function selectSuggestion(
    suggestion: LocationSuggestion | { placeId: string },
  ): Promise<void> {
    const autocomplete = TestBed.createComponent(MatAutocomplete);
    const option = TestBed.createComponent(MatOption);
    option.componentInstance.value = suggestion;
    return fixture.componentInstance.selectOption(
      new MatAutocompleteSelectedEvent(
        autocomplete.componentInstance,
        option.componentInstance,
      ),
    );
  }

  function makeSuggestion(placeId = 'place-1'): LocationSuggestion {
    const place: GooglePlaceReference = {
      displayName: null,
      fetchFields: vi.fn<GooglePlaceReference['fetchFields']>(),
      formattedAddress: null,
      id: placeId,
      location: null,
    };
    return {
      mainText: 'Alexanderplatz',
      place,
      placeId,
      secondaryText: 'Berlin, Germany',
    };
  }
});
