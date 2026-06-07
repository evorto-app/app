import { expect, test } from '@playwright/test';

import {
  expectedStablePageLayout,
  readPageLayout,
} from '../../support/utils/page-layout';

test('shared page layout helper reports stable pages', async ({ page }) => {
  await page.setViewportSize({ height: 740, width: 320 });
  await page.setContent(`
    <main>
      <h1>Stable mobile page</h1>
      <a href="/events">Events</a>
      <button type="button">Continue</button>
    </main>
  `);

  await expect(readPageLayout(page)).resolves.toEqual(expectedStablePageLayout);
});

test('shared page layout helper labels overflow, coverage, and clipped controls', async ({
  page,
}) => {
  await page.setViewportSize({ height: 740, width: 320 });
  await page.setContent(`
    <style>
      body {
        margin: 0;
      }

      .wide-panel {
        background: #f5f5f5;
        margin-top: 24px;
        width: 520px;
      }

      .covered-action {
        position: absolute;
        left: 24px;
        top: 120px;
      }

      .covering-layer {
        background: rgb(255 255 255 / 0.95);
        height: 44px;
        left: 18px;
        position: absolute;
        top: 116px;
        width: 150px;
        z-index: 2;
      }

      .clipped-action {
        margin-left: 290px;
        margin-top: 96px;
        width: 96px;
      }

      .clipped-icon-action {
        height: 44px;
        margin-left: 304px;
        margin-top: 12px;
        width: 44px;
      }

      .unlabeled-icon-action {
        height: 44px;
        margin-left: 24px;
        margin-top: 12px;
        width: 44px;
      }

      .covered-text {
        left: 24px;
        position: absolute;
        top: 240px;
        width: 180px;
      }

      .clipped-text {
        margin-left: 260px;
        margin-top: 24px;
        width: 180px;
      }

      .text-covering-layer {
        background: rgb(255 255 255 / 0.95);
        height: 34px;
        left: 20px;
        position: fixed;
        top: 234px;
        width: 190px;
        z-index: 3;
      }

      .fixed-clipped-text {
        left: 24px;
        line-height: 32px;
        margin: 0;
        position: fixed;
        top: -8px;
      }

      .fixed-clipped-action {
        left: 200px;
        position: fixed;
        top: -10px;
      }
    </style>
    <main>
      <h1>Broken mobile page</h1>
      <section class="wide-panel">Overflowing visible panel</section>
      <button class="covered-action" type="button">Covered action</button>
      <div class="covering-layer">Overlay</div>
      <button class="clipped-action" type="button">Clipped action</button>
      <button
        aria-label="Icon-only clipped action"
        class="clipped-icon-action"
        type="button"
      ></button>
      <button class="unlabeled-icon-action" type="button"></button>
      <p class="covered-text">Covered readable copy</p>
      <p class="clipped-text">Clipped readable copy</p>
      <div
        aria-label="Notification switch"
        class="clipped-switch"
        role="switch"
        style="display: block; height: 32px; margin-left: 298px; margin-top: 12px; width: 88px;"
      ></div>
      <div
        class="clipped-menuitem"
        role="menuitem"
        style="margin-left: 294px; margin-top: 12px; width: 120px;"
      >
        Menu action
      </div>
      <div
        aria-label="Payment method"
        class="clipped-combobox"
        role="combobox"
        style="height: 36px; margin-left: 296px; margin-top: 12px; width: 128px;"
      ></div>
      <div
        aria-label="Capacity slider"
        class="clipped-slider"
        role="slider"
        style="height: 32px; margin-left: 300px; margin-top: 12px; width: 112px;"
      ></div>
      <div
        aria-label="Guest count"
        class="clipped-spinbutton"
        role="spinbutton"
        style="height: 32px; margin-left: 300px; margin-top: 12px; width: 100px;"
      ></div>
      <div
        class="clipped-radio"
        role="radio"
        style="height: 32px; margin-left: 296px; margin-top: 12px; width: 104px;"
      >
        Radio option
      </div>
      <div
        class="clipped-focusable"
        style="height: 32px; margin-left: 300px; margin-top: 12px; width: 118px;"
        tabindex="0"
      >
        Focusable action
      </div>
      <p class="fixed-clipped-text">Fixed clipped readable copy</p>
      <p class="loading-placeholder">Loading profile settings...</p>
      <button class="fixed-clipped-action" type="button">
        Fixed clipped action
      </button>
      <div class="text-covering-layer">Text overlay</div>
    </main>
  `);

  const layout = await readPageLayout(page);

  expect(layout.appError).toBe(false);
  expect(layout.horizontalOverflow).toBe(true);
  expect(layout.horizontallyOverflowingElementLabels).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        className: 'wide-panel',
        text: 'Overflowing visible panel',
      }),
    ]),
  );
  expect(layout.coveredControlLabels).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        className: 'covered-action',
        coveringClassName: 'covering-layer',
        text: 'Covered action',
      }),
    ]),
  );
  expect(layout.coveredTextLabels).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        className: 'covered-text',
        coveringClassName: 'text-covering-layer',
        text: 'Covered readable copy',
      }),
    ]),
  );
  expect(layout.horizontallyClippedTextLabels).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        className: 'clipped-text',
        text: 'Clipped readable copy',
      }),
    ]),
  );
  expect(layout.verticallyClippedFixedTextLabels).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        className: 'fixed-clipped-text',
        position: 'fixed',
        text: 'Fixed clipped readable copy',
      }),
    ]),
  );
  expect(layout.verticallyClippedFixedControlLabels).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        className: 'fixed-clipped-action',
        position: 'fixed',
        text: 'Fixed clipped action',
      }),
    ]),
  );
  expect(layout.horizontallyClippedControlLabels).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        className: 'clipped-action',
        text: 'Clipped action',
      }),
      expect.objectContaining({
        className: 'clipped-icon-action',
        text: 'Icon-only clipped action',
      }),
      expect.objectContaining({
        className: 'clipped-switch',
        text: 'Notification switch',
      }),
      expect.objectContaining({
        className: 'clipped-menuitem',
        text: 'Menu action',
      }),
      expect.objectContaining({
        className: 'clipped-combobox',
        text: 'Payment method',
      }),
      expect.objectContaining({
        className: 'clipped-slider',
        text: 'Capacity slider',
      }),
      expect.objectContaining({
        className: 'clipped-spinbutton',
        text: 'Guest count',
      }),
      expect.objectContaining({
        className: 'clipped-radio',
        text: 'Radio option',
      }),
      expect.objectContaining({
        className: 'clipped-focusable',
        text: 'Focusable action',
      }),
    ]),
  );
  expect(layout.unlabeledControlLabels).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        className: 'unlabeled-icon-action',
      }),
    ]),
  );
  expect(layout.visibleLoadingTextLabels).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        className: 'loading-placeholder',
        text: 'Loading profile settings...',
      }),
    ]),
  );
});

test('shared page layout helper ignores intentional horizontal scroll containers', async ({
  page,
}) => {
  await page.setViewportSize({ height: 740, width: 320 });
  await page.setContent(`
    <style>
      .table-scroll {
        max-width: 320px;
        overflow-x: auto;
      }

      table {
        width: 720px;
      }
    </style>
    <main>
      <h1>Scrollable table page</h1>
      <div class="table-scroll">
        <table>
          <tr>
            <td>Long table content</td>
            <td><button type="button">Table action</button></td>
          </tr>
        </table>
      </div>
    </main>
  `);

  await expect(readPageLayout(page)).resolves.toEqual(expectedStablePageLayout);
});

test('shared page layout helper ignores Material paginator touch target overlap', async ({
  page,
}) => {
  await page.setViewportSize({ height: 900, width: 1440 });
  await page.setContent(`
    <style>
      .mat-mdc-paginator {
        position: relative;
      }

      .mat-mdc-select {
        display: block;
        height: 32px;
        left: 1080px;
        position: absolute;
        top: 150px;
        width: 120px;
      }

      .mat-mdc-paginator-touch-target {
        height: 48px;
        left: 1070px;
        position: absolute;
        top: 142px;
        width: 140px;
        z-index: 2;
      }
    </style>
    <main>
      <h1>Paginated table page</h1>
      <div class="mat-mdc-paginator">
        <mat-select
          aria-label="Items per page:"
          class="mat-mdc-select"
          role="combobox"
        >
          Items per page:
        </mat-select>
        <div class="mat-mdc-paginator-touch-target"></div>
      </div>
    </main>
  `);

  await expect(readPageLayout(page)).resolves.toEqual(expectedStablePageLayout);
});

test('shared page layout helper treats nested control icons as the same surface', async ({
  page,
}) => {
  await page.setViewportSize({ height: 740, width: 320 });
  await page.setContent(`
    <style>
      a {
        display: inline-flex;
        gap: 8px;
        margin: 24px;
        padding: 12px 16px;
      }

      .icon {
        display: inline-block;
        height: 24px;
        width: 24px;
      }
    </style>
    <main>
      <h1>Nested icon control page</h1>
      <a href="/tenants">
        <span class="icon" aria-hidden="true"></span>
        Review tenant
      </a>
    </main>
  `);

  await expect(readPageLayout(page)).resolves.toEqual(expectedStablePageLayout);
});
