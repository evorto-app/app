import { expect, test as base } from '@playwright/test';
import fs from 'node:fs';

import {
  resolveStorageState,
  type StorageState,
  validateStorageStateBeforeUse,
} from '../../support/utils/storage-state';

const test = base.extend<{ storageStateValidation: void }>({
  storageStateValidation: [validateStorageStateBeforeUse, { auto: true }],
});
const state = {
  cookies: [
    {
      domain: 'storage-state.example.test',
      expires: -1,
      httpOnly: true,
      name: 'synthetic-session',
      path: '/',
      sameSite: 'Lax',
      secure: true,
      value: 'synthetic-value',
    },
  ],
  origins: [
    {
      localStorage: [{ name: 'fixture', value: '' }],
      origin: 'https://storage-state.example.test',
    },
  ],
} satisfies StorageState;

test('rejects invalid saved state before a context consumer runs', async ({}, testInfo) => {
  const statePath = testInfo.outputPath('invalid-state.json');
  fs.writeFileSync(statePath, JSON.stringify({ cookies: [{}], origins: [] }));
  let consumers = 0;

  await expect(
    validateStorageStateBeforeUse({ storageState: statePath }, async () => {
      consumers += 1;
    }),
  ).rejects.toThrow('is invalid');
  expect(consumers).toBe(0);
});

test('roundtrips validated file state through a real offline context', async ({
  browser,
}, testInfo) => {
  const statePath = testInfo.outputPath('state.json');
  fs.writeFileSync(statePath, JSON.stringify(state));
  const context = await browser.newContext({
    offline: true,
    storageState: resolveStorageState(statePath),
  });
  try {
    const captured = await context.storageState();
    expect(captured.cookies).toEqual([
      expect.objectContaining(state.cookies[0]),
    ]);
    expect(captured.origins).toEqual(state.origins);
  } finally {
    await context.close();
  }
});

test.describe('inline state validated by the automatic fixture', () => {
  test.use({ offline: true, storageState: state });

  test('preserves cookies and local storage before the built-in context is used', async ({
    context,
  }) => {
    const captured = await context.storageState();
    expect(captured.cookies).toEqual([
      expect.objectContaining(state.cookies[0]),
    ]);
    expect(captured.origins).toEqual(state.origins);
  });
});
