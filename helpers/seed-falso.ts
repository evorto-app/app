import { seed as seedFalso } from '@ngneat/falso';

const pad = (value: number) => String(value).padStart(2, '0');

export const getDailySeed = (date: Date = new Date()) => {
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  return `${year}-${month}-${day}`;
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
