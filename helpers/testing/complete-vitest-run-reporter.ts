import type {
  Reporter,
  TestCase,
  TestModule,
  TestRunEndReason,
  TestSpecification,
} from 'vitest/node';

type VitestTestObservation = Readonly<{
  expectedFailure: boolean;
  flaky: boolean;
  mode: TestCase['options']['mode'];
  retryCount: number;
  state: ReturnType<TestCase['result']>['state'];
}>;

export const incompleteVitestTestReasons = (
  observation: VitestTestObservation,
): string[] => {
  const reasons: string[] = [];

  if (observation.mode === 'only') {
    reasons.push('focused-only');
  }
  if (observation.state === 'pending' || observation.state === 'skipped') {
    reasons.push(`${observation.state}:${observation.mode}`);
  }
  if (observation.expectedFailure) {
    reasons.push('expected-failure');
  }
  if (observation.retryCount > 0) {
    reasons.push(
      observation.flaky
        ? `flaky-after-${observation.retryCount}-retries`
        : `retried-${observation.retryCount}-times`,
    );
  } else if (observation.flaky) {
    reasons.push('flaky');
  }

  return reasons;
};

export const incompleteVitestRunReason = (
  reason: TestRunEndReason,
): string | undefined =>
  reason === 'interrupted' ? 'test run (interrupted)' : undefined;

class CompleteVitestRunReporter implements Reporter {
  private readonly focusedTestConfigurationViolations = new Set<string>();

  onTestRunStart(testSpecifications: readonly TestSpecification[]): void {
    this.focusedTestConfigurationViolations.clear();

    for (const testSpecification of testSpecifications) {
      if (testSpecification.project.config.allowOnly) {
        this.focusedTestConfigurationViolations.add(
          testSpecification.project.name || '<default>',
        );
      }
    }
  }

  onTestRunEnd(
    testModules: readonly TestModule[],
    _unhandledErrors: readonly unknown[],
    runReason: TestRunEndReason,
  ): void {
    const interruptedRun = incompleteVitestRunReason(runReason);
    const violations = [
      ...(interruptedRun === undefined ? [] : [interruptedRun]),
      ...[...this.focusedTestConfigurationViolations].map(
        (projectName) =>
          `focused tests are allowed by project configuration: ${projectName}`,
      ),
      ...testModules.flatMap((testModule) =>
        [...testModule.children.allTests()].flatMap((testCase) => {
          const result = testCase.result();
          const diagnostic = testCase.diagnostic();
          const reasons = incompleteVitestTestReasons({
            expectedFailure: testCase.options.fails === true,
            flaky: diagnostic?.flaky === true,
            mode: testCase.options.mode,
            retryCount: diagnostic?.retryCount ?? 0,
            state: result.state,
          });

          return reasons.length === 0
            ? []
            : [
                `${testModule.relativeModuleId} > ${testCase.fullName} (${reasons.join(', ')})`,
              ];
        }),
      ),
    ];

    if (violations.length === 0) {
      return;
    }

    process.stderr.write(
      `\nComplete Vitest run required; incomplete tests found:\n${violations
        .map((violation) => `- ${violation}`)
        .join('\n')}\n`,
    );
    process.exitCode = 1;
  }
}

export default CompleteVitestRunReporter;
