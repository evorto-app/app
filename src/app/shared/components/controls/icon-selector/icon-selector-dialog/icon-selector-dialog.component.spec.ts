import { RpcUnauthorizedError } from '@shared/errors/rpc-errors';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { iconAddErrorMessage } from './icon-selector-dialog.component';

const iconSelectorTemplate = () =>
  readFileSync(
    path.join(
      process.cwd(),
      'src/app/shared/components/controls/icon-selector/icon-selector-dialog/icon-selector-dialog.component.html',
    ),
    'utf8',
  );

describe('IconSelectorDialogComponent accessibility', () => {
  it('renders icon choices as named, keyboard-focusable buttons', () => {
    const template = iconSelectorTemplate();

    expect(template).toContain('type="button"');
    expect(template).toContain(
      '[attr.aria-labelledby]="\'select-icon-\' + icon.id"',
    );
    expect(template).toContain('class="sr-only"');
    expect(template).toContain('Select {{ icon.friendlyName }} icon');
    expect(template).toContain(
      'class="bg-surface text-on-surface break-all rounded px-2 text-sm"',
    );
    expect(template).toContain('class="text-on-surface!">Cancel</button>');
    expect(template).toContain("We couldn't load the icons.");
    expect(template).toContain('iconSearchQuery.refetch()');
  });
});

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
