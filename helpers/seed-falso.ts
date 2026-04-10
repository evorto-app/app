import { seed as seedFalso } from '@ngneat/falso';

import { getSeedDayKey } from './seed-clock';

const resolvePinnedSeedKey = (): string | undefined => {
  const value = process.env['E2E_SEED_KEY']?.trim();
  return value && value.length > 0 ? value : undefined;
};

export const getDailySeed = (date?: Date) => {
  return resolvePinnedSeedKey() ?? getSeedDayKey(date);
};

export const buildSeed = (scope?: string, date?: Date) => {
  const base = getDailySeed(date);
  return scope ? `${base}:${scope}` : base;
};

export const seedFalsoForScope = (scope?: string, date?: Date) => {
  const seed = buildSeed(scope, date);
  seedFalso(seed);
  return seed;
};
