export const runDatabaseCleanups = async (
  cleanups: readonly (() => Promise<void>)[],
  closeDatabase: () => Promise<void>,
): Promise<void> => {
  const errors: unknown[] = [];
  for (const cleanup of cleanups.toReversed()) {
    try {
      await cleanup();
    } catch (error) {
      errors.push(error);
    }
  }
  try {
    await closeDatabase();
  } catch (error) {
    errors.push(error);
  }
  if (errors.length > 0) {
    throw new AggregateError(errors, 'Database test cleanup failed');
  }
};
