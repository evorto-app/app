import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

const dotenvFiles = ['.env.local', '.env', '.env.development'] as const;

let loaded = false;

export const loadDotenvFiles = (): void => {
  if (loaded) {
    return;
  }

  for (const file of dotenvFiles) {
    const filePath = path.resolve(process.cwd(), file);
    if (!fs.existsSync(filePath)) {
      continue;
    }

    dotenv.config({
      override: true,
      path: filePath,
    });
  }

  loaded = true;
};
