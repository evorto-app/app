import { describe, expect, it } from 'vitest';

import {
  persistedAdvancedToSimpleModeBlockMessage,
  persistedAdvancedToSimpleModeIssue,
} from './registration-mode-transition';

const simpleShapedOptions = [
  { id: 'organizer-option', organizingRegistration: true },
  { id: 'participant-option', organizingRegistration: false },
] as const;

describe('persistedAdvancedToSimpleModeIssue', () => {
  it('leaves unsaved template creation unrestricted', () => {
    expect(
      persistedAdvancedToSimpleModeIssue(undefined, simpleShapedOptions),
    ).toBeNull();
  });

  it('allows a simple-shaped persisted advanced graph when option IDs are preserved', () => {
    expect(
      persistedAdvancedToSimpleModeIssue(
        {
          registrationOptions: simpleShapedOptions,
          simpleModeEnabled: false,
        },
        simpleShapedOptions,
      ),
    ).toBeNull();
  });

  it('requires compatible advanced changes to be saved and reopened first', () => {
    expect(
      persistedAdvancedToSimpleModeIssue(
        {
          registrationOptions: [
            ...simpleShapedOptions,
            { id: 'guest-option', organizingRegistration: false },
          ],
          simpleModeEnabled: false,
        },
        simpleShapedOptions,
      ),
    ).toBe(persistedAdvancedToSimpleModeBlockMessage);
    expect(persistedAdvancedToSimpleModeBlockMessage).toContain(
      'reopen this editor',
    );
  });

  it('blocks replacing a persisted option ID during the mode change', () => {
    expect(
      persistedAdvancedToSimpleModeIssue(
        {
          registrationOptions: simpleShapedOptions,
          simpleModeEnabled: false,
        },
        [simpleShapedOptions[0], { id: 'replacement-option' }],
      ),
    ).toBe(persistedAdvancedToSimpleModeBlockMessage);
  });

  it('does not apply the transition guard to a graph persisted in simple mode', () => {
    expect(
      persistedAdvancedToSimpleModeIssue(
        {
          registrationOptions: simpleShapedOptions,
          simpleModeEnabled: true,
        },
        [{ id: 'replacement-option' }],
      ),
    ).toBeNull();
  });
});
