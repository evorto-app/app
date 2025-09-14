import {
  argbFromRgb,
  QuantizerCelebi,
  Score,
} from '@material/material-color-utilities';

/**
 * Compute the Material source color (ARGB int) for a given icon common name.
 * - Derives the icon URL similar to the Angular IconComponent
 * - Downloads image, properly decodes PNG, and extracts the dominant/source color using material-color-utilities
 * Returns undefined on network or parsing failures to avoid blocking inserts/migrations.
 */
const colorCache = new Map<string, Promise<number | undefined>>();

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

      // Load and decode the PNG image using skia-canvas (dynamic import for server-only usage)
      const { Canvas, loadImage } = await import('skia-canvas');
      const img = await loadImage(url);
      const canvas = new Canvas(img.width, img.height);
      const context = canvas.getContext('2d');
      
      // Draw image to canvas to get actual RGBA pixel data
      context.drawImage(img, 0, 0);
      const imageData = context.getImageData(0, 0, img.width, img.height);
      const bytes = imageData.data; // This is proper RGBA pixel data

      const pixels: number[] = [];
      for (let index = 0; index < bytes.length; index += 4) {
        const r = bytes[index];
        const g = bytes[index + 1];
        const b = bytes[index + 2];
        const a = bytes[index + 3];
        if (a < 255) continue; // Skip transparent pixels
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
    // Fallback: return undefined to avoid blocking operations
    return undefined;
  }
}
