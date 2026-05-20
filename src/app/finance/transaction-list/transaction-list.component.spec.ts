import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const transactionListTemplate = () =>
  readFileSync(
    path.join(
      process.cwd(),
      'src/app/finance/transaction-list/transaction-list.component.html',
    ),
    'utf8',
  );

describe('TransactionListComponent template', () => {
  it('does not advertise manual transaction creation without an implemented route', () => {
    const template = transactionListTemplate();

    expect(template).not.toContain('Create transaction');
    expect(template).not.toContain('routerLink="edit"');
  });
});
