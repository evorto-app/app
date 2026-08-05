import { readFileSync } from 'node:fs';
import nodePath from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  templateEditLoadErrorMessage,
  templateEditSaveErrorMessage,
} from './template-edit.component';

describe('template edit error messages', () => {
  it('uses payment readiness without reading the payment account identifier', () => {
    const source = readFileSync(
      nodePath.join(
        process.cwd(),
        'src/app/templates/template-edit/template-edit.component.ts',
      ),
      'utf8',
    );

    expect(source).toContain('paymentsConfigured');
    expect(source).not.toContain('stripeAccountId');
  });

  it('shows when the requested template is no longer available', () => {
    expect(
      templateEditLoadErrorMessage({
        _tag: 'TemplateSimpleNotFoundError',
        message: 'This template could not be found.',
      }),
    ).toBe('This template could not be found.');
  });

  it('shows an actionable form problem', () => {
    expect(
      templateEditSaveErrorMessage({
        _tag: 'RpcBadRequestError',
        message: 'Choose an available tax rate for each paid add-on.',
      }),
    ).toBe('Choose an available tax rate for each paid add-on.');
  });

  it.each([
    new Error('database failed'),
    { _tag: 'TemplateSimpleInternalError', message: 'database failed' },
    { _tag: 'RpcUnauthorizedError', message: 'token expired' },
  ])('keeps technical and access failures behind plain copy', (error) => {
    expect(templateEditLoadErrorMessage(error)).toBe(
      'This template could not be loaded. Try again.',
    );
    expect(templateEditSaveErrorMessage(error)).toBe(
      'The template could not be saved. Try again.',
    );
  });
});
