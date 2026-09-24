type CleanupStage =
  | 'registered fixture callback'
  | 'database pool closure'
  | 'application document discard'
  | 'tenant request settlement'
  | 'tenant request drain'
  | 'browser page closure'
  | 'browser context closure';

// Static labels only: cleanup diagnostics must never expose URLs, SQL, or data.
export const observeCleanupProgress = async <T>(
  stage: CleanupStage,
  operation: () => Promise<T>,
): Promise<T> => {
  const timer = setTimeout(() => {
    process.stderr.write(`[test cleanup] ${stage} still pending after 10s\n`);
  }, 10_000);
  timer.unref();
  try {
    return await operation();
  } finally {
    clearTimeout(timer);
  }
};
