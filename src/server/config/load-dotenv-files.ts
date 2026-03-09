import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';

let loaded = false;

const resolveDotenvFiles = (): string[] => {
  const files = ['.env.local', '.env'];
  if (process.env['CI'] === 'true') {
    files.push('.env.ci');
  }
  files.push('.env.development');

  return files;
};

export const loadDotenvFiles = (): void => {
  if (loaded) {
    return;
  }

  const protectedKeys = new Set(Object.keys(process.env));
  for (const file of resolveDotenvFiles()) {
    const filePath = path.resolve(process.cwd(), file);
    if (!fs.existsSync(filePath)) {
      continue;
    }

    const parsed = dotenv.parse(fs.readFileSync(filePath));
    for (const [key, value] of Object.entries(parsed)) {
      if (protectedKeys.has(key)) {
        continue;
      }

      process.env[key] = value;
    }
  }

  loaded = true;
};
