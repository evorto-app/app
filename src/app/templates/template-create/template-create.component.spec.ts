import { readFileSync } from 'node:fs';
import nodePath from 'node:path';
import { describe, expect, it } from 'vitest';

import { templateCreateErrorMessage } from './template-create.component';

describe('templateCreateErrorMessage', () => {
  it('uses payment readiness without reading the payment account identifier', () => {
    const source = readFileSync(
      nodePath.join(
        process.cwd(),
        'src/app/templates/template-create/template-create.component.ts',
      ),
      'utf8',
    );

    expect(source).toContain('paymentsConfigured');
    expect(source).not.toContain('stripeAccountId');
  });

  it('shows an actionable form problem', () => {
    expect(
      templateCreateErrorMessage({
        _tag: 'RpcBadRequestError',
        message: 'Add a title and description for this template.',
      }),
    ).toBe('Add a title and description for this template.');
  });

  it.each([
    new Error('database failed'),
    { _tag: 'RpcInternalServerError', message: 'database failed' },
    { _tag: 'RpcUnauthorizedError', message: 'token expired' },
  ])('keeps technical and access failures behind plain copy', (error) => {
    expect(templateCreateErrorMessage(error)).toBe(
      'The template could not be saved. Try again.',
    );
  });
});
