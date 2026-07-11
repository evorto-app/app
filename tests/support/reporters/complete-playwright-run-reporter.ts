import type {
  FullResult,
  Reporter,
  TestCase,
  TestResult,
} from '@playwright/test/reporter';

class CompletePlaywrightRunReporter implements Reporter {
  private readonly incompleteTests = new Set<string>();

  onTestEnd(test: TestCase, result: TestResult): void {
    const reasons: string[] = [];
    if (result.status === 'skipped' || result.status === 'interrupted') {
      reasons.push(result.status);
    }
    if (test.expectedStatus !== 'passed') {
      reasons.push(`expected-${test.expectedStatus}`);
    }
    if (result.retry > 0) {
      reasons.push(`retry-${result.retry}`);
    }

    if (reasons.length === 0) {
      return;
    }

    this.incompleteTests.add(
      `${test.location.file}:${test.location.line} > ${test.titlePath().join(' > ')} (${reasons.join(', ')})`,
    );
  }

  onEnd(): { status?: FullResult['status'] } | undefined {
    if (this.incompleteTests.size === 0) {
      return undefined;
    }

    process.stderr.write(
      `\nComplete Playwright run required; incomplete tests found:\n${[
        ...this.incompleteTests,
      ]
        .map((test) => `- ${test}`)
        .join('\n')}\n`,
    );
    return { status: 'failed' };
  }

  printsToStdio(): boolean {
    return false;
  }
}

export default CompletePlaywrightRunReporter;
