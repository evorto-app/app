import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

import {
  isStorageStateFresh,
  readStorageState,
} from '../../support/utils/storage-state';

test('storage state freshness checks age and shape', async ({}, testInfo) => {
  const statePath = testInfo.outputPath('state.json');
  // Write a minimal valid storage state
  fs.writeFileSync(
    statePath,
    JSON.stringify({
      cookies: [{ name: 'appSession', value: 'session' }],
    }),
    'utf-8',
  );

  // Set mtime to 2 days ago
  const twoDaysMs = 1000 * 60 * 60 * 48;
  const past = new Date(Date.now() - twoDaysMs);
  fs.utimesSync(statePath, past, past);

  // Freshness should fail due to age
  expect(
    isStorageStateFresh({
      pathname: statePath,
      maxAgeMs: 24 * 60 * 60 * 1000,
    }),
  ).toBe(false);

  // Current, valid state is reusable.
  const now = new Date();
  fs.utimesSync(statePath, now, now);
  expect(
    isStorageStateFresh({
      pathname: statePath,
      maxAgeMs: 24 * 60 * 60 * 1000,
    }),
  ).toBe(true);
});
