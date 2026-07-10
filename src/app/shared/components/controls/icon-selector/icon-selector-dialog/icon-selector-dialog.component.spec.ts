import { RpcUnauthorizedError } from '@shared/errors/rpc-errors';
import { describe, expect, it } from 'vitest';

import { iconAddErrorMessage } from './icon-selector-dialog.component';

describe('iconAddErrorMessage', () => {
  it.each([
    ['IconSourceBusyError', 'The icon source is busy. Try again shortly.'],
    [
      'IconSourceUnavailableError',
      'That Icons8 icon could not be verified. Check the name and try again.',
    ],
    [
      'InvalidIconNameError',
      'Use a lowercase Icons8 name with letters, numbers, hyphens, and at most one style suffix.',
    ],
    ['RpcForbiddenError', 'You do not have permission to add icons here.'],
  ])('maps %s to a clear message', (tag, expected) => {
    expect(iconAddErrorMessage({ _tag: tag })).toBe(expected);
  });

  it('surfaces the typed authentication error message', () => {
    expect(
      iconAddErrorMessage(
        new RpcUnauthorizedError({ message: 'Authentication required' }),
      ),
    ).toBe('Authentication required');
  });
});
