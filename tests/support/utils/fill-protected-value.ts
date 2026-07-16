import {
  expect,
  test,
  type Locator,
  type PlaywrightTestOptions,
  type PlaywrightWorkerOptions,
} from '@playwright/test';

import {
  type ProtectedEnvironmentVariable,
  readProtectedEnvironmentValue,
} from '../protected-values';

const protectedInputStepTitle = 'Enter protected value';
const protectedInputFailureMessage = 'Protected input entry failed';
const protectedInputArtifactError =
  'Protected input requires Playwright trace, screenshot, video, HAR, and context video capture to be off and protected-value artifact sanitization to be enabled';

export type ProtectedValueCaptureOptions = Pick<
  PlaywrightTestOptions,
  'contextOptions'
> &
  Pick<PlaywrightWorkerOptions, 'screenshot' | 'trace' | 'video'>;

let activeCaptureOptions: ProtectedValueCaptureOptions | undefined;

export const withProtectedValueCaptureOptions = async (
  options: ProtectedValueCaptureOptions,
  use: () => Promise<void>,
): Promise<void> => {
  if (activeCaptureOptions !== undefined) {
    throw new Error('Protected input capture policy is already active');
  }

  activeCaptureOptions = options;
  try {
    await use();
  } finally {
    activeCaptureOptions = undefined;
  }
};

const captureMode = (
  option:
    | PlaywrightWorkerOptions['screenshot']
    | PlaywrightWorkerOptions['trace']
    | PlaywrightWorkerOptions['video'],
): string => (typeof option === 'string' ? option : option.mode);

const assertArtifactCaptureIsOff = (): void => {
  if (
    activeCaptureOptions === undefined ||
    captureMode(activeCaptureOptions.screenshot) !== 'off' ||
    captureMode(activeCaptureOptions.trace) !== 'off' ||
    captureMode(activeCaptureOptions.video) !== 'off' ||
    activeCaptureOptions.contextOptions.recordHar !== undefined ||
    activeCaptureOptions.contextOptions.recordVideo !== undefined ||
    process.env['PLAYWRIGHT_NO_COPY_PROMPT'] !== '1' ||
    process.env['PLAYWRIGHT_PROTECTED_VALUE_SANITIZER'] !== '1'
  ) {
    throw new Error(protectedInputArtifactError);
  }
};

const setNativeFormValue = (
  element: HTMLInputElement | HTMLTextAreaElement,
  value: string,
): void => {
  const prototype =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const valueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;

  if (!valueSetter) {
    throw new Error('Protected input element has no native value setter');
  }

  valueSetter.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  element.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
};

/**
 * Resolves a registered protected environment variable inside a value-free
 * Playwright step and uses the native form-control setter so the protected value
 * never appears in Playwright API step titles. Capture must be off because
 * evaluate arguments are serialized when tracing is enabled.
 * Matcher-generated ARIA context is removed and remaining text diagnostics are
 * redacted by the protected-value sanitizer reporter.
 */
export const fillProtectedValue = async (
  locator: Locator,
  variableName: ProtectedEnvironmentVariable,
  options: Readonly<{ trim?: boolean }> = {},
): Promise<void> => {
  assertArtifactCaptureIsOff();
  const value = readProtectedEnvironmentValue(variableName, options);

  await test.step(
    protectedInputStepTitle,
    async () => {
      try {
        await expect(locator).toBeVisible();
        await expect(locator).toBeEditable();
        await locator.focus();
        await locator.evaluate(setNativeFormValue, value);
      } catch {
        throw new Error(protectedInputFailureMessage);
      }
    },
    { box: true },
  );
};
