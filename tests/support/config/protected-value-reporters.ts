import type { ReporterDescription } from '@playwright/test';

export const completePlaywrightRunReporterPath =
  './tests/support/reporters/complete-playwright-run-reporter.ts';
export const documentationReporterPath =
  './tests/support/reporters/documentation-reporter.ts';
export const protectedValueSanitizerReporterPath =
  './tests/support/reporters/protected-value-sanitizer-reporter.ts';

const approvedReporterOverrides = new Set([
  protectedValueSanitizerReporterPath,
  documentationReporterPath,
  completePlaywrightRunReporterPath,
  'dot',
  'github',
]);

type PlaywrightReporterPolicy = {
  ci: boolean;
  includeDocumentation?: boolean;
  listOnly: boolean;
};

const resolvePlaywrightReporterNames = ({
  ci,
  includeDocumentation = !ci,
  listOnly,
}: PlaywrightReporterPolicy): string[] => {
  const terminalReporters = ci ? ['github', 'dot'] : ['dot'];
  return [
    protectedValueSanitizerReporterPath,
    ...terminalReporters,
    ...(includeDocumentation && !listOnly ? [documentationReporterPath] : []),
    completePlaywrightRunReporterPath,
  ];
};

export const resolvePlaywrightReporters = (
  policy: PlaywrightReporterPolicy,
): ReporterDescription[] =>
  resolvePlaywrightReporterNames(policy).map((reporter) => [reporter]);

export const resolvePlaywrightReporterArgument = (
  policy: PlaywrightReporterPolicy,
): string => `--reporter=${resolvePlaywrightReporterNames(policy).join(',')}`;

const cliReporterOverrides = (argv: readonly string[]): string[] => {
  const cliOverrides: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument?.startsWith('--reporter=')) {
      cliOverrides.push(argument.slice('--reporter='.length));
    } else if (argument === '--reporter') {
      cliOverrides.push(argv[index + 1] ?? '');
      index += 1;
    }
  }
  return cliOverrides;
};

const reporterChainIsApproved = (override: string): boolean => {
  const reporters = override
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  return (
    reporters[0] === protectedValueSanitizerReporterPath &&
    reporters.every((reporter) => approvedReporterOverrides.has(reporter))
  );
};

export const resolveProtectedValueSanitizerState = ({
  argv,
  currentState,
  environmentOverride,
}: {
  argv: readonly string[];
  currentState: string | undefined;
  environmentOverride: string | undefined;
}): '0' | '1' => {
  const cliOverrides = cliReporterOverrides(argv);
  // Raw process arguments do not identify whether reporter-looking text is an
  // effective option, follows `--`, or is another option's required value.
  // Require every candidate to be safe so an unsafe effective reporter cannot
  // be hidden behind a later safe-looking positional or option value.
  if (cliOverrides.some((override) => !reporterChainIsApproved(override))) {
    return '0';
  }
  // Playwright appends PW_TEST_REPORTER after the configured/CLI reporters.
  // Validate that additive sink independently so a safe CLI chain cannot hide
  // an unsafe persistent reporter such as blob, JSON, JUnit, or HTML.
  if (
    environmentOverride !== undefined &&
    !approvedReporterOverrides.has(environmentOverride)
  ) {
    return '0';
  }
  if (cliOverrides.length === 0 && environmentOverride === undefined) {
    return currentState === '0' ? '0' : '1';
  }
  return '1';
};
