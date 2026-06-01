import { describe, expect, it } from '@effect/vitest';

import { createId } from './create-id';

describe('createId', () => {
  it('creates non-sequential ids suitable for ticket links', () => {
    const ids = Array.from({ length: 64 }, () => createId());

    expect(ids).toHaveLength(new Set(ids).size);
    expect(ids).toEqual(ids.map((id) => id.toLowerCase()));
    expect(ids.every((id) => /^[a-z0-9]{20}$/u.test(id))).toBe(true);
    expect(ids).not.toEqual(ids.toSorted());
  });
});
