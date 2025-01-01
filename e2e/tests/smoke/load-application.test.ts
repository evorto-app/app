import { defaultStateFile } from '../../../helpers/user-data';
import { test } from '../../fixtures/parallel-test';

test.use({ storageState: defaultStateFile });

test('load application', async ({ page }) => {
  await page.goto('.');
});
