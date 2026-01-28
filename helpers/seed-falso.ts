import { seed as seedFalso } from '@ngneat/falso';

import { getSeedDayKey } from './seed-clock';

export const getDailySeed = (date: Date = new Date()) => {
  return getSeedDayKey(date);
};

export const buildSeed = (scope?: string, date: Date = new Date()) => {
  const base = getDailySeed(date);
  return scope ? `${base}:${scope}` : base;
};

export const seedFalsoForScope = (scope?: string, date: Date = new Date()) => {
  const seed = buildSeed(scope, date);
  seedFalso(seed);
  return seed;
};
