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
  });
});

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
