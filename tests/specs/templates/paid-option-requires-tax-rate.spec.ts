import { test } from '../../support/fixtures/parallel-test';

test.describe('Template Tax Rate Validation', () => {
  test.fixme('creator must select tax rate for paid registration option', async () => {});

  test.fixme('tax rate field disabled for free registration option', async () => {});

  test.fixme('creator cannot save paid option without compatible tax rate', async () => {});

  test.fixme('creator can only select compatible inclusive active tax rates', async () => {});

  test.fixme('bulk operations respect tax rate validation', async () => {});

  test.fixme('blocked creation when no compatible rates are available', async () => {});
});
