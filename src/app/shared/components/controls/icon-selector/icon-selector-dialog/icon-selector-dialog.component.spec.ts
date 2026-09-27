import { RpcUnauthorizedError } from '@shared/errors/rpc-errors';
import { describe, expect, it } from 'vitest';

import { iconAddErrorMessage } from './icon-selector-dialog.component';

describe('iconAddErrorMessage', () => {
  it.each([
    ['IconSourceBusyError', "We couldn't add this icon right now. Try again."],
    [
      'IconSourceUnavailableError',
      "We couldn't add this icon right now. Try again.",
    ],
    [
      'InvalidIconNameError',
      "We couldn't find that icon. Choose one from the list or try another search.",
    ],
    [
      'RpcForbiddenError',
      'Your account does not have access to add icons here.',
    ],
  ])('maps %s to a clear message', (tag, expected) => {
    expect(iconAddErrorMessage({ _tag: tag })).toBe(expected);
  });

  it('does not expose the authentication error message', () => {
    expect(
      iconAddErrorMessage(
        new RpcUnauthorizedError({ message: 'Authentication required' }),
      ),
    ).toBe("We couldn't add this icon. Try again.");
  });
});
