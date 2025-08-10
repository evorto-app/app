import {
  argbFromRgb,
  QuantizerCelebi,
  Score,
} from '@material/material-color-utilities';

/**
 * Compute the Material source color (ARGB int) for a given icon common name.
 * - Derives the icon URL similar to the Angular IconComponent
 * - Downloads image bytes and extracts the dominant/source color using material-color-utilities
 * Returns undefined on network or parsing failures to avoid blocking inserts/migrations.
 */
export async function computeIconSourceColor(
  iconCommonName: string,
): Promise<number | undefined> {
  try {
    const [nameRaw, setRaw] = (iconCommonName ?? '').split(':');
    const name = nameRaw || 'nothing-found';
    const set = setRaw || 'fluent';
    // Use 192 like the Angular component to be consistent
    const url = `https://img.icons8.com/${set}/128/${name}.png`;

    const response = await fetch(url);
    if (!response.ok) return undefined;
    const arrayBuffer = await response.arrayBuffer();
    const bytes = new Uint8ClampedArray(arrayBuffer);

    const pixels: number[] = [];
    for (let index = 0; index < bytes.length; index += 4) {
      const r = bytes[index];
      const g = bytes[index + 1];
      const b = bytes[index + 2];
      const a = bytes[index + 3];
      if (a < 255) continue;
      const argb = argbFromRgb(r, g, b);
      pixels.push(argb);
    }
    if (pixels.length === 0) return undefined;
    const result = QuantizerCelebi.quantize(pixels, 128);
    const ranked = Score.score(result);
    return ranked[0];
  } catch {
    return undefined;
  }
}
