import { DateTime } from 'luxon';

/** Legacy Prisma DateTime values were stored in PostgreSQL timestamp columns in UTC. */
export const legacyTimestampDateTime = (
  value: string,
  context: string,
): DateTime => {
  const timestamp = DateTime.fromSQL(value, { zone: 'utc' });
  if (!timestamp.isValid) {
    throw new Error(
      `${context} has an invalid legacy UTC timestamp: ${timestamp.invalidExplanation ?? timestamp.invalidReason ?? 'unknown parse error'}.`,
    );
  }
  return timestamp;
};

export const legacyTimestamp = (value: string, context: string): Date =>
  legacyTimestampDateTime(value, context).toJSDate();
