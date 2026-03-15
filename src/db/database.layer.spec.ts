import { describe, expect, it } from '@effect/vitest';

import { Database, databaseLayer } from './database.layer';

describe('database.layer', () => {
  it('exports the database tag and layer', () => {
    expect(Database).toBeDefined();
    expect(databaseLayer).toBeDefined();
  });
});
