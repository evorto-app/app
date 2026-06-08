import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const userListTemplate = (): string =>
  readFileSync(
    fileURLToPath(new URL('user-list.component.html', import.meta.url)),
    'utf8',
  );

describe('UserListComponent template', () => {
  it('renders a visible error state when users fail to load', () => {
    const template = userListTemplate();

    expect(template).toContain('usersQuery.isError()');
    expect(template).toContain('Failed to load users.');
  });
});
