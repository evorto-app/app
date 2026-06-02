import { readFileSync } from 'node:fs';
import nodePath from 'node:path';
import { describe, expect, it } from 'vitest';

const userListTemplate = (): string =>
  readFileSync(
    nodePath.join(
      process.cwd(),
      'src/app/admin/user-list/user-list.component.html',
    ),
    'utf8',
  );

describe('UserListComponent template', () => {
  it('renders a visible error state when users fail to load', () => {
    const template = userListTemplate();

    expect(template).toContain('usersQuery.isError()');
    expect(template).toContain('Failed to load users.');
  });
});
