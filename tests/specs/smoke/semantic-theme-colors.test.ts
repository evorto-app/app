import { expect, type Page, test } from '@playwright/test';

const themes = ['theme-evorto', 'theme-esn'] as const;
const colorSchemes = ['light', 'dark'] as const;
const semanticPairs = [
  {
    background: '--app-success',
    foreground: '--app-on-success',
    label: 'success',
  },
  {
    background: '--app-success-container',
    foreground: '--app-on-success-container',
    label: 'success container',
  },
  {
    background: '--app-warning',
    foreground: '--app-on-warning',
    label: 'warning',
  },
  {
    background: '--app-warning-container',
    foreground: '--app-on-warning-container',
    label: 'warning container',
  },
] as const;

interface RenderedPair {
  background: string;
  foreground: string;
  label: string;
}

const readRenderedPairs = (page: Page): Promise<RenderedPair[]> =>
  page.evaluate((pairs) => {
    const rootStyle = getComputedStyle(document.documentElement);

    return pairs.map(({ background, foreground, label }) => {
      if (!rootStyle.getPropertyValue(background).trim()) {
        throw new Error(`Missing semantic theme token ${background}`);
      }
      if (!rootStyle.getPropertyValue(foreground).trim()) {
        throw new Error(`Missing semantic theme token ${foreground}`);
      }

      const probe = document.createElement('span');
      probe.style.backgroundColor = `var(${background})`;
      probe.style.color = `var(${foreground})`;
      document.body.append(probe);
      const style = getComputedStyle(probe);
      const rendered = {
        background: style.backgroundColor,
        foreground: style.color,
        label,
      };
      probe.remove();
      return rendered;
    });
  }, semanticPairs);

const colorChannels = (color: string): readonly [number, number, number] => {
  const channels = color.match(/[\d.]+/g)?.map(Number);
  if (!channels || channels.length < 3) {
    throw new Error(`Cannot read rendered CSS color: ${color}`);
  }

  if (color.startsWith('color(srgb')) {
    return [channels[0] * 255, channels[1] * 255, channels[2] * 255];
  }
  return [channels[0], channels[1], channels[2]];
};

const relativeLuminance = (color: string): number => {
  const [red, green, blue] = colorChannels(color).map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.040_45
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
};

const contrastRatio = ({ background, foreground }: RenderedPair): number => {
  const light = Math.max(
    relativeLuminance(background),
    relativeLuminance(foreground),
  );
  const dark = Math.min(
    relativeLuminance(background),
    relativeLuminance(foreground),
  );
  return (light + 0.05) / (dark + 0.05);
};

test('success and warning roles stay legible across both themes and contrast modes', async ({
  page,
}) => {
  await page.goto('/events');
  await expect(page.locator('html')).toHaveClass(/theme-(?:esn|evorto)/);

  for (const theme of themes) {
    await page.evaluate((selectedTheme) => {
      document.documentElement.classList.remove('theme-evorto', 'theme-esn');
      document.documentElement.classList.add(selectedTheme);
    }, theme);

    for (const colorScheme of colorSchemes) {
      await page.emulateMedia({ colorScheme, contrast: 'no-preference' });
      const standardPairs = await readRenderedPairs(page);

      for (const pair of standardPairs) {
        expect(
          contrastRatio(pair),
          `${theme} ${colorScheme} ${pair.label} standard contrast`,
        ).toBeGreaterThanOrEqual(4.5);
      }

      await page.emulateMedia({ colorScheme, contrast: 'more' });
      const increasedPairs = await readRenderedPairs(page);

      for (const [index, pair] of increasedPairs.entries()) {
        expect(
          contrastRatio(pair),
          `${theme} ${colorScheme} ${pair.label} increased contrast`,
        ).toBeGreaterThanOrEqual(7);
        expect(pair.background).not.toBe(standardPairs[index].background);
      }
    }
  }
});
