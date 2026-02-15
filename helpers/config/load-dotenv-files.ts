import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

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

  for (const file of resolveDotenvFiles()) {
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
