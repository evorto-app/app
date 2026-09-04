import { expect, type Page, test } from '@playwright/test';

const themes = ['theme-evorto', 'theme-classic', 'theme-esn'] as const;
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
const materialPairs = [
  {
    background: '--mat-sys-primary',
    foreground: '--mat-sys-on-primary',
    label: 'primary',
  },
  {
    background: '--mat-sys-primary-container',
    foreground: '--mat-sys-on-primary-container',
    label: 'primary container',
  },
  {
    background: '--mat-sys-tertiary',
    foreground: '--mat-sys-on-tertiary',
    label: 'tertiary',
  },
  {
    background: '--mat-sys-surface',
    foreground: '--mat-sys-on-surface',
    label: 'surface',
  },
] as const;

const expectedPrimaryChannels = {
  'theme-evorto': {
    dark: {
      increased: [240, 238, 255],
      standard: [189, 194, 255],
    },
    light: {
      increased: [1, 18, 146],
      standard: [69, 82, 196],
    },
  },
  'theme-classic': {
    dark: {
      increased: [219, 244, 255],
      standard: [108, 211, 247],
    },
    light: {
      increased: [0, 49, 62],
      standard: [0, 103, 128],
    },
  },
  'theme-esn': {
    dark: {
      increased: [226, 242, 255],
      standard: [130, 207, 255],
    },
    light: {
      increased: [0, 48, 69],
      standard: [0, 101, 141],
    },
  },
} as const;

interface RenderedPair {
  background: string;
  foreground: string;
  label: string;
}

const readRenderedPairs = (
  page: Page,
  pairs: readonly {
    readonly background: string;
    readonly foreground: string;
    readonly label: string;
  }[],
): Promise<RenderedPair[]> =>
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
  }, pairs);

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

test('success and warning roles stay legible across all themes and contrast modes', async ({
  page,
}) => {
  await page.goto('/events');
  await expect(page.locator('html')).toHaveClass(
    /theme-(?:classic|esn|evorto)/,
  );

  for (const theme of themes) {
    await page.evaluate((selectedTheme) => {
      document.documentElement.classList.remove(
        'theme-evorto',
        'theme-classic',
        'theme-esn',
      );
      document.documentElement.classList.add(selectedTheme);
    }, theme);

    for (const colorScheme of colorSchemes) {
      await page.emulateMedia({ colorScheme, contrast: 'no-preference' });
      const standardPairs = await readRenderedPairs(page, semanticPairs);

      for (const pair of standardPairs) {
        expect(
          contrastRatio(pair),
          `${theme} ${colorScheme} ${pair.label} standard contrast`,
        ).toBeGreaterThanOrEqual(4.5);
      }

      const standardMaterialPairs = await readRenderedPairs(
        page,
        materialPairs,
      );
      for (const pair of standardMaterialPairs) {
        expect(
          contrastRatio(pair),
          `${theme} ${colorScheme} ${pair.label} standard contrast`,
        ).toBeGreaterThanOrEqual(4.5);
      }
      expect(
        colorChannels(standardMaterialPairs[0].background).map(Math.round),
        `${theme} ${colorScheme} standard primary role`,
      ).toEqual(expectedPrimaryChannels[theme][colorScheme].standard);

      await page.emulateMedia({ colorScheme, contrast: 'more' });
      const increasedPairs = await readRenderedPairs(page, semanticPairs);

      for (const [index, pair] of increasedPairs.entries()) {
        expect(
          contrastRatio(pair),
          `${theme} ${colorScheme} ${pair.label} increased contrast`,
        ).toBeGreaterThanOrEqual(7);
        expect(pair.background).not.toBe(standardPairs[index].background);
      }

      const increasedMaterialPairs = await readRenderedPairs(
        page,
        materialPairs,
      );
      for (const pair of increasedMaterialPairs) {
        expect(
          contrastRatio(pair),
          `${theme} ${colorScheme} ${pair.label} increased contrast`,
        ).toBeGreaterThanOrEqual(7);
      }
      expect(
        colorChannels(increasedMaterialPairs[0].background).map(Math.round),
        `${theme} ${colorScheme} increased-contrast primary role`,
      ).toEqual(expectedPrimaryChannels[theme][colorScheme].increased);
    }
  }
});
