import { describe, expect, it } from '@effect/vitest';

import {
  isRegistrationEligibilityChangedAfterPaymentRefundOperationKey,
  isUserEligibleForRegistrationOption,
  registrationEligibilityCompensationRefundOperationKey,
} from './registration-eligibility';

describe('registration eligibility', () => {
  it('allows unrestricted options and intersects restricted option roles', () => {
    expect(
      isUserEligibleForRegistrationOption({
        optionRoleIds: [],
        userRoleIds: [],
      }),
    ).toBe(true);
    expect(
      isUserEligibleForRegistrationOption({
        optionRoleIds: ['role-eligible'],
        userRoleIds: ['role-other', 'role-eligible'],
      }),
    ).toBe(true);
    expect(
      isUserEligibleForRegistrationOption({
        optionRoleIds: ['role-eligible'],
        userRoleIds: ['role-other'],
      }),
    ).toBe(false);
  });

  it('recognizes only eligibility compensation refund operation keys', () => {
    const operationKey =
      registrationEligibilityCompensationRefundOperationKey('transaction-1');

    expect(operationKey).toBe(
      'registration-eligibility-compensation:transaction-1',
    );
    expect(
      isRegistrationEligibilityChangedAfterPaymentRefundOperationKey(
        operationKey,
        'transaction-1',
      ),
    ).toBe(true);
    expect(
      isRegistrationEligibilityChangedAfterPaymentRefundOperationKey(
        'registration-transfer-compensation:transfer-1',
        'transaction-1',
      ),
    ).toBe(false);
    expect(
      isRegistrationEligibilityChangedAfterPaymentRefundOperationKey(
        'registration-eligibility-compensation:',
        '',
      ),
    ).toBe(false);
    expect(
      isRegistrationEligibilityChangedAfterPaymentRefundOperationKey(
        null,
        'transaction-1',
      ),
    ).toBe(false);
    expect(
      isRegistrationEligibilityChangedAfterPaymentRefundOperationKey(
        operationKey,
        'transaction-2',
      ),
    ).toBe(false);
  });
});
