import { getId } from '../../../helpers/get-id';
import { expect, test } from '../../support/fixtures/parallel-test';
import { seedFreeAddonRegistrationEvent } from '../../support/utils/seed-registration-addons';
import { futureServerEventWindow } from '../../support/utils/server-test-clock';

test.use({
  storageState: { cookies: [], origins: [] },
  reducedMotion: 'no-preference',
});

const morphTest = test.extend<{ morphEvents: { from: string; to: string } }>({
  morphEvents: async (
    { database, registerDatabaseCleanup, seeded, tenant },
    use,
  ) => {
    const prefix = getId().slice(0, 19);
    const create = (suffix: string) =>
      seedFreeAddonRegistrationEvent({
        database,
        eventId: prefix + suffix,
        registerDatabaseCleanup,
        sourceEventId: seeded.scenario.events.freeOpen.eventId,
        sourceOptionId: seeded.scenario.events.freeOpen.optionId,
        tenantId: tenant.id,
        window: futureServerEventWindow(),
      });
    const from = await create('a');
    const to = await create('b');
    await use({ from: from.eventId, to: to.eventId });
  },
});

morphTest(
  'morphs the live SVG through intermediate paths without a page crossfade',
  async ({ morphEvents, page }) => {
    await page.goto(`/events/${morphEvents.to}`);
    const path = page.locator('[aria-label="Selected event"] app-shape path');
    const target = await path.evaluate((element) =>
      getComputedStyle(element).getPropertyValue('d'),
    );
    await page.reload();
    await expect(path).toHaveCSS('d', target);
    await page.goto(`/events/${morphEvents.from}`);
    const start = await path.evaluate((element) =>
      getComputedStyle(element).getPropertyValue('d'),
    );
    expect(start).not.toBe(target);
    const link = page
      .getByRole('region', { name: 'Event list', exact: true })
      .locator(`a[href="/events/${morphEvents.to}"]`);
    await expect(link).not.toHaveAttribute('jsaction', /click/);
    await link.click();
    await expect(page).toHaveURL(`/events/${morphEvents.to}`);
    await expect
      .poll(() =>
        path.evaluate((element) =>
          element
            .getAnimations()
            .some(
              (animation) =>
                animation instanceof CSSTransition &&
                animation.transitionProperty === 'd',
            ),
        ),
      )
      .toBe(true);
    const frame = await path.evaluate((element) => {
      const morph = element
        .getAnimations()
        .find(
          (animation) =>
            animation instanceof CSSTransition &&
            animation.transitionProperty === 'd',
        );
      if (!morph) throw new Error('Expected a running path morph');
      morph.pause();
      morph.currentTime = 275;
      const middle = getComputedStyle(element).getPropertyValue('d');
      const snapshots = document
        .getAnimations()
        .filter(
          (animation) =>
            animation.effect instanceof KeyframeEffect &&
            animation.effect.pseudoElement?.startsWith('::view-transition'),
        ).length;
      morph.finish();
      return { middle, snapshots };
    });
    expect(frame.middle).not.toBe(start);
    expect(frame.middle).not.toBe(target);
    expect(frame.snapshots).toBe(0);
    await expect(path).toHaveCSS('d', target);
    await expect(path).toHaveCSS('opacity', '1');
  },
);

morphTest(
  'switches the SVG immediately for reduced motion',
  async ({ morphEvents, page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`/events/${morphEvents.from}`);
    const path = page.locator('[aria-label="Selected event"] app-shape path');
    const start = await path.getAttribute('d');
    const link = page
      .getByRole('region', { name: 'Event list', exact: true })
      .locator(`a[href="/events/${morphEvents.to}"]`);
    await expect(link).not.toHaveAttribute('jsaction', /click/);
    await link.click();
    await expect(page).toHaveURL(`/events/${morphEvents.to}`);
    await expect(path).not.toHaveAttribute('d', start ?? '');
    await expect(path).toHaveCSS('transition-duration', '0s');
    await expect(page.locator('app-shape svg')).toHaveCSS(
      'animation-name',
      'none',
    );
  },
);
