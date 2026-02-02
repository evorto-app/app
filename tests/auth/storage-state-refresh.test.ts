import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

import {
  isStorageStateFresh,
  readStorageState,
} from '../../e2e/utils/storage-state';

test('storage state freshness - age and tenant cookie checks @track(playwright-specs-track-linking_20260126) @req(STORAGE-STATE-REFRESH-TEST-01)', async ({}, testInfo) => {
  const statePath = testInfo.outputPath('state.json');
  // Write a minimal valid storage state
  fs.writeFileSync(
    statePath,
    JSON.stringify({
      cookies: [{ name: 'evorto-tenant', value: 'wrong-tenant' }],
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
      tenantDomain: 'localhost',
      maxAgeMs: 24 * 60 * 60 * 1000,
    }),
  ).toBe(false);

  // Update mtime to now but keep wrong cookie
  const now = new Date();
  fs.utimesSync(statePath, now, now);
  expect(
    isStorageStateFresh({
      pathname: statePath,
      tenantDomain: 'localhost',
      maxAgeMs: 24 * 60 * 60 * 1000,
    }),
  ).toBe(false);

  // Fix cookie to match tenant
  fs.writeFileSync(
    statePath,
    JSON.stringify({
      cookies: [{ name: 'evorto-tenant', value: 'localhost' }],
    }),
    'utf-8',
  );
  fs.utimesSync(statePath, now, now);
  expect(
    isStorageStateFresh({
      pathname: statePath,
      tenantDomain: 'localhost',
      maxAgeMs: 24 * 60 * 60 * 1000,
    }),
  ).toBe(true);
});
