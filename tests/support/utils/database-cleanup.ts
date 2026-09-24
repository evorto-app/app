import { observeCleanupProgress } from './cleanup-progress';

export const runDatabaseCleanups = async (
  cleanups: readonly (() => Promise<void>)[],
  closeDatabase: () => Promise<void>,
): Promise<void> => {
  const errors: unknown[] = [];
  for (const cleanup of cleanups.toReversed()) {
    try {
      await observeCleanupProgress('registered fixture callback', cleanup);
    } catch (error) {
      errors.push(error);
    }
  }
  try {
    await observeCleanupProgress('database pool closure', closeDatabase);
  } catch (error) {
    errors.push(error);
  }
  if (errors.length > 0) {
    throw new AggregateError(errors, 'Database test cleanup failed');
  }
};
