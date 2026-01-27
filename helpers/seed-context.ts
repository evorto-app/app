import { seed as seedFalso } from '@ngneat/falso';
import { DateTime } from 'luxon';

export interface SeedContext {
  baseDate: DateTime;
  seed: string;
}

let activeSeed: null | string = null;

export const getSeedContext = (seedOverride?: string): SeedContext => {
  const seed =
    seedOverride ??
    process.env['SEED'] ??
    process.env['SEED_DATE'] ??
    DateTime.now().toISODate();
  if (activeSeed !== seed) {
    seedFalso(seed);
    activeSeed = seed;
  }
  const baseDateCandidate = process.env['SEED_DATE']
    ? DateTime.fromISO(process.env['SEED_DATE'])
    : seedOverride
      ? DateTime.fromISO(seedOverride)
      : process.env['SEED']
        ? DateTime.fromISO(process.env['SEED'])
        : DateTime.now();
  const baseDate = baseDateCandidate.isValid
    ? baseDateCandidate.startOf('day')
    : DateTime.now().startOf('day');
  return { baseDate, seed };
};
