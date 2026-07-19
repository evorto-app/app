import { describe, expect, it } from 'vitest';

import { legacyEventLocation } from '../../migration/legacy-event-location';

describe('legacy event location mapping', () => {
  it('preserves a provider-backed Google location', () => {
    expect(
      legacyEventLocation({
        coordinates: { lat: 48.13, lng: 11.58 },
        googlePlaceId: ' place-1 ',
        isVirtual: false,
        name: 'Munich',
        onlineMeetingUrl: null,
      }),
    ).toEqual({
      coordinates: { lat: 48.13, lng: 11.58 },
      name: 'Munich',
      placeId: 'place-1',
      type: 'google',
    });
  });

  it('uses the coordinate target type when no Google place ID exists', () => {
    expect(
      legacyEventLocation({
        coordinates: { lat: 48.13, lng: 11.58 },
        googlePlaceId: null,
        isVirtual: false,
        name: 'Meeting point',
        onlineMeetingUrl: null,
      }),
    ).toEqual({
      coordinates: { lat: 48.13, lng: 11.58 },
      name: 'Meeting point',
      type: 'coordinate',
    });
  });

  it('keeps a missing optional location empty', () => {
    expect(
      legacyEventLocation({
        coordinates: null,
        googlePlaceId: null,
        isVirtual: false,
        name: '   ',
        onlineMeetingUrl: null,
      }),
    ).toBeNull();
  });

  it('blocks physical location text that cannot be represented without coordinates', () => {
    expect(() =>
      legacyEventLocation({
        coordinates: null,
        googlePlaceId: null,
        isVirtual: false,
        name: 'Meeting point',
        onlineMeetingUrl: null,
      }),
    ).toThrow('has no target coordinates');
  });

  it.each([{}, { lat: '48', lng: 11 }, { lat: 48, lng: Number.NaN }])(
    'blocks malformed coordinates %o',
    (coordinates) => {
      expect(() =>
        legacyEventLocation({
          coordinates,
          googlePlaceId: null,
          isVirtual: false,
          name: 'Broken',
          onlineMeetingUrl: null,
        }),
      ).toThrow('has invalid coordinates');
    },
  );

  it('maps a valid virtual event to the target online location', () => {
    expect(
      legacyEventLocation({
        coordinates: null,
        googlePlaceId: null,
        isVirtual: true,
        name: 'Remote session',
        onlineMeetingUrl: ' https://meet.example/session ',
      }),
    ).toEqual({
      meetingProvider: 'other',
      meetingUrl: 'https://meet.example/session',
      name: 'Remote session',
      type: 'online',
    });
  });

  it('treats the legacy virtual-location empty coordinate object as absent', () => {
    expect(
      legacyEventLocation({
        coordinates: {},
        googlePlaceId: null,
        isVirtual: true,
        name: 'Remote session',
        onlineMeetingUrl: 'https://meet.example/session',
      }),
    ).toMatchObject({
      meetingUrl: 'https://meet.example/session',
      type: 'online',
    });
  });

  it('blocks missing or contradictory virtual state', () => {
    expect(() =>
      legacyEventLocation({
        coordinates: null,
        googlePlaceId: null,
        isVirtual: true,
        name: 'Remote session',
        onlineMeetingUrl: null,
      }),
    ).toThrow('has no meeting URL');
    expect(() =>
      legacyEventLocation({
        coordinates: { lat: 48.13, lng: 11.58 },
        googlePlaceId: null,
        isVirtual: true,
        name: 'Contradictory',
        onlineMeetingUrl: 'https://meet.example/session',
      }),
    ).toThrow('also has physical coordinates');
    expect(() =>
      legacyEventLocation({
        coordinates: null,
        googlePlaceId: null,
        isVirtual: false,
        name: 'Contradictory',
        onlineMeetingUrl: 'https://meet.example/session',
      }),
    ).toThrow('also has an online meeting URL');
  });
});
