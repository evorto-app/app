import { describe, expect, it } from '@effect/vitest';
import { Schema } from 'effect';

import {
  IconAddUsage,
  Icons8IconName,
  IconSearchInput,
  isValidIcons8IconName,
} from './icons.rpcs';

describe('icon RPC schemas', () => {
  it.each([
    'calendar',
    'calendar:color',
    'discount--v1',
    '3d-printer:fluency-systems-regular',
  ])('accepts normalized Icons8 name %s', (icon) => {
    expect(Schema.decodeUnknownSync(Icons8IconName)(icon)).toBe(icon);
    expect(isValidIcons8IconName(icon)).toBe(true);
  });

  it.each([
    '',
    ' Calendar',
    'calendar ',
    'Calendar',
    'calendar/color',
    'calendar:color:filled',
    'calendar::color',
    '-calendar',
    'calendar-',
    `${'a'.repeat(97)}:color`,
    'a'.repeat(129),
  ])('rejects non-normalized Icons8 name %s', (icon) => {
    expect(() => Schema.decodeUnknownSync(Icons8IconName)(icon)).toThrow();
    expect(isValidIcons8IconName(icon)).toBe(false);
  });

  it('requires a tagged authoring usage', () => {
    expect(
      Schema.decodeUnknownSync(IconAddUsage)({
        _tag: 'eventEdit',
        eventId: 'event-1',
      }),
    ).toMatchObject({ _tag: 'eventEdit', eventId: 'event-1' });
    expect(() =>
      Schema.decodeUnknownSync(IconAddUsage)({ eventId: 'event-1' }),
    ).toThrow();
  });

  it('caps search terms at 64 characters', () => {
    expect(
      Schema.decodeUnknownSync(IconSearchInput)({ search: 'a'.repeat(64) }),
    ).toEqual({ search: 'a'.repeat(64) });
    expect(() =>
      Schema.decodeUnknownSync(IconSearchInput)({ search: 'a'.repeat(65) }),
    ).toThrow();
  });
});
