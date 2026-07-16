export const resolvePlaywrightProjectPolicy = (
  safeUiBaseline: boolean,
): {
  includeAuthenticatedProjects: boolean;
  modeDependencies: string[];
} => ({
  includeAuthenticatedProjects: !safeUiBaseline,
  modeDependencies: [safeUiBaseline ? 'database-setup' : 'setup'],
});
