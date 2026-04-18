import {
  argbFromRgb,
  QuantizerCelebi,
  Score,
} from '@material/material-color-utilities';
import { PNG } from 'pngjs';

/**
 * Compute the Material source color (ARGB int) for a given icon common name.
 * - Derives the icon URL similar to the Angular IconComponent
 * - Downloads image, decodes PNG bytes, and extracts the dominant/source color using material-color-utilities
 * Returns undefined on network or parsing failures to avoid blocking inserts/migrations.
 */
const colorCache = new Map<string, Promise<number | undefined>>();

const parsePng = async (bytes: Uint8Array): Promise<PNG> =>
  new Promise<PNG>((resolve, reject) => {
    const parser = new PNG();
    parser.parse(Buffer.from(bytes), (error, data) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(data);
    });
  });

export async function computeIconSourceColor(
  iconCommonName: string,
): Promise<number | undefined> {
  try {
    if (colorCache.has(iconCommonName)) {
      return await colorCache.get(iconCommonName);
    }
    const promise = (async () => {
      const [nameRaw, setRaw] = (iconCommonName ?? '').split(':');
      const name = nameRaw || 'nothing-found';
      const set = setRaw || 'fluent';
      // Use 128 size for consistent results
      const url = `https://img.icons8.com/${set}/128/${name}.png`;

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Icon fetch failed with status ${response.status}`);
      }
      const png = await parsePng(new Uint8Array(await response.arrayBuffer()));
      const bytes = png.data;

      const pixels: number[] = [];
      for (let index = 0; index < bytes.length; index += 4) {
        const r = bytes[index];
        const g = bytes[index + 1];
        const b = bytes[index + 2];
        const a = bytes[index + 3];
        if (a === 0) continue; // Skip fully transparent pixels
        const argb = argbFromRgb(r, g, b);
        pixels.push(argb);
      }

      if (pixels.length === 0) return;

      // Use Material Color Utilities to find the best source color
      const result = QuantizerCelebi.quantize(pixels, 128);
      const ranked = Score.score(result);
      return ranked[0];
    })();
    colorCache.set(iconCommonName, promise);
    return await promise;
  } catch {
    return undefined;
  }
}
