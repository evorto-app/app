import {
  alphaFromArgb,
  argbFromRgb,
  blueFromArgb,
  greenFromArgb,
  QuantizerCelebi,
  redFromArgb,
  Score,
} from '@material/material-color-utilities';

/**
 * Convert an icon string into its PNG image bytes.
 * - Derives the URL the same way as the icon component
 * - Downloads the image and returns its bytes
 */
export async function iconStringToImageBytes(
  iconCommonName: string,
): Promise<Uint8ClampedArray> {
  const url = deriveIconUrl(iconCommonName);
  return fetchBytes(url);
}

/**
 * Main entry to test with tsx: downloads the icon and prints its source color.
 */
export async function main(): Promise<number> {
  const bytes = await iconStringToImageBytes('beer');
  const color = sourceColorFromImageBytes(bytes);
  // Log as integer ARGB and hex string
  const redComponent = redFromArgb(color);
  const greenComponent = greenFromArgb(color);
  const blueComponent = blueFromArgb(color);
  const hex = `#${redComponent
    .toString(16)
    .padStart(
      2,
      '0',
    )}${greenComponent.toString(16).padStart(2, '0')}${blueComponent
    .toString(16)
    .padStart(2, '0')}`;
  console.log('Source color (ARGB int):', color, 'hex:', hex);
  return color;
}

/**
 * Get the source color from image bytes.
 *
 * @param imageBytes The image bytes
 * @return Source color - the color most suitable for creating a UI theme
 */
export function sourceColorFromImageBytes(imageBytes: Uint8ClampedArray) {
  // Convert Image data to Pixel Array
  const pixels: number[] = [];
  for (let index = 0; index < imageBytes.length; index += 4) {
    const r = imageBytes[index];
    const g = imageBytes[index + 1];
    const b = imageBytes[index + 2];
    const a = imageBytes[index + 3];
    if (a < 255) {
      continue;
    }
    const argb = argbFromRgb(r, g, b);
    pixels.push(argb);
  }

  // Convert Pixels to Material Colors
  const result = QuantizerCelebi.quantize(pixels, 128);
  const ranked = Score.score(result);
  const top = ranked[0];
  return top;
}

/**
 * Derive the icon URL from a common name string.
 * Format: "<name>:<set>", defaults to name="nothing-found", set="fluent"
 * Example: "home:fluent" -> https://img.icons8.com/fluent/192/home.png
 */
function deriveIconUrl(iconCommonName: string): string {
  const [nameRaw, setRaw] = (iconCommonName ?? '').split(':');
  const name = nameRaw || 'nothing-found';
  const set = setRaw || 'fluent';
  return `https://img.icons8.com/${set}/128/${name}.png`;
}

/**
 * Fetch a URL and return its bytes as Uint8ClampedArray using fetch.
 */
async function fetchBytes(url: string): Promise<Uint8ClampedArray> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  }
  const ab = await res.arrayBuffer();
  return new Uint8ClampedArray(ab);
}

// If executed directly with tsx/node, run main.
if (
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1]
) {
  (async () => {
    try {
      const { pathToFileURL } = await import('node:url');
      const isDirect = pathToFileURL(process.argv[1]).href === import.meta.url;
      if (isDirect) {
        await main();
      }
    } catch {
      // Best-effort fallback
      await main();
    }
  })();
}
