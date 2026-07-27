import { afterEach, describe, expect, it } from 'vitest';

import {
  focusProfileDetailHeading,
  profileChildPageActive,
} from './profile-shell.component';

describe('profile shell route behavior', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('distinguishes the overview from routed detail pages', () => {
    expect(profileChildPageActive(undefined)).toBe(false);
    expect(profileChildPageActive('')).toBe(false);
    expect(profileChildPageActive('events')).toBe(true);
  });

  it('moves focus to the routed detail heading', () => {
    const content = document.createElement('main');
    const heading = document.createElement('h1');
    heading.id = 'profile-detail-heading';
    heading.tabIndex = -1;
    content.append(heading);
    document.body.append(content);

    focusProfileDetailHeading(content);

    expect(document.activeElement).toBe(heading);
  });

  it('surfaces a missing detail heading contract', () => {
    const content = document.createElement('main');

    expect(() => focusProfileDetailHeading(content)).toThrowError(
      'Profile detail routes must render #profile-detail-heading.',
    );
  });
});
