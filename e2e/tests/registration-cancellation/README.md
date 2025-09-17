# Registration Cancellation Configuration Tests

This directory contains Playwright E2E tests for the registration cancellation configuration feature.

## Test Coverage

- **cancellation.doc.ts**: Documentation test that generates user-facing docs for the feature
- **happy-path.spec.ts**: Happy path test for paid cancellation with partial fee retention
- **policy-inheritance.spec.ts**: Tests for policy inheritance and override scenarios
- **permissions.spec.ts**: Tests for permission requirements and UI visibility

## Test Scenarios

The tests cover:
1. Tenant policy setup and configuration
2. Option inheritance vs custom override
3. Cancellation before/after cutoff
4. Refund composition visibility
5. Hidden actions after cutoff
6. Permission-based access control
7. Reason capture and auditing

These tests follow the TDD approach and should fail initially until the implementation is complete.