import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const script = fileURLToPath(
  new URL(
    '../../ops/scaleway/prime-bun-fontawesome-cache.mjs',
    import.meta.url,
  ),
);
const packageName = '@fortawesome/fixture-icons';
const version = '1.0.0';
const registryUrl = 'https://npm.fontawesome.com/fixture-icons.tgz';
const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

const fixture = (
  options: {
    layout?: string;
    extractedName?: string;
    traversal?: boolean;
  } = {},
) => {
  const directory = mkdtempSync(
    path.join(tmpdir(), 'evorto-private-cache-test-'),
  );
  directories.push(directory);
  const contents = path.join(directory, 'contents');
  const layout = options.layout ?? 'package';
  const packageDirectory = path.join(contents, layout);
  const archive = path.join(directory, 'package.tgz');
  const cache = path.join(directory, 'cache');
  const temporary = path.join(directory, 'temporary');
  const lockfile = path.join(directory, 'bun.lock');
  const fetchLog = path.join(directory, 'fetch.log');
  const preload = path.join(directory, 'fetch-fixture.mjs');
  mkdirSync(packageDirectory, { recursive: true });
  mkdirSync(temporary);
  writeFileSync(
    path.join(packageDirectory, 'package.json'),
    JSON.stringify({ name: options.extractedName ?? packageName, version }),
  );
  writeFileSync(
    path.join(packageDirectory, 'index.js'),
    'export const fixture = true;\n',
  );
  if (options.traversal)
    writeFileSync(path.join(contents, 'escape'), 'fixture');
  execFileSync(
    'tar',
    [
      '--create',
      '--gzip',
      '-P',
      '--file',
      archive,
      '--directory',
      contents,
      options.traversal ? 'package/../escape' : layout,
    ],
    {
      env: { PATH: process.env['PATH'], COPYFILE_DISABLE: '1' },
      timeout: 5000,
    },
  );
  const integrity = `sha512-${createHash('sha512').update(readFileSync(archive)).digest('base64')}`;
  writeFileSync(
    preload,
    `
import assert from 'node:assert/strict';
import { appendFileSync, readFileSync } from 'node:fs';
globalThis.fetch = async (url, options) => {
  assert.equal(String(url), ${JSON.stringify(registryUrl)});
  assert.deepEqual(options.headers, { Authorization: 'Bearer fixture-private-token' });
  appendFileSync(process.env.FIXTURE_FETCH_LOG, 'download\\n');
  return new Response(readFileSync(process.env.FIXTURE_ARCHIVE));
};
`,
  );
  const cacheDirectory = path.join(
    cache,
    `${packageName}@${version}@@npm.fontawesome.com@@@1`,
  );
  return {
    cacheDirectory,
    downloads: () =>
      existsSync(fetchLog)
        ? readFileSync(fetchLog, 'utf8').trim().split('\n').length
        : 0,
    run: (
      overrides: { integrity?: string; resolved?: string; url?: string } = {},
    ) => {
      writeFileSync(
        lockfile,
        JSON.stringify({
          packages: {
            [packageName]: [
              overrides.resolved ?? `${packageName}@${version}`,
              overrides.url ?? registryUrl,
              {},
              overrides.integrity ?? integrity,
            ],
          },
        }),
      );
      const result = spawnSync(
        process.execPath,
        ['--import', pathToFileURL(preload).href, script, lockfile, cache],
        {
          cwd: directory,
          encoding: 'utf8',
          env: {
            PATH: process.env['PATH'],
            TMPDIR: temporary,
            FONT_AWESOME_TOKEN: 'fixture-private-token',
            FIXTURE_ARCHIVE: archive,
            FIXTURE_FETCH_LOG: fetchLog,
          },
          timeout: 5000,
        },
      );
      expect(result.error).toBeUndefined();
      expect(result.signal).toBeNull();
      expect(readdirSync(temporary)).toEqual([]);
      return result;
    },
  };
};

describe('private package cache CLI', () => {
  it('caches a verified archive and reuses matching package metadata without another download', () => {
    const cache = fixture();
    const first = cache.run();
    expect(first.status, first.stderr).toBe(0);
    expect(first.stdout).toContain(`Primed ${packageName}@${version}`);
    expect(
      JSON.parse(
        readFileSync(path.join(cache.cacheDirectory, 'package.json'), 'utf8'),
      ),
    ).toEqual({ name: packageName, version });
    expect(
      readFileSync(path.join(cache.cacheDirectory, 'index.js'), 'utf8'),
    ).toBe('export const fixture = true;\n');
    const repeated = cache.run();
    expect(repeated.status, repeated.stderr).toBe(0);
    expect(repeated.stdout).toContain(
      `Verified cached ${packageName}@${version}`,
    );
    expect(cache.downloads()).toBe(1);
  });

  it.each([
    {
      name: 'insecure registry URL',
      overrides: { url: registryUrl.replace('https:', 'http:') },
      error: 'Unexpected registry URL',
      downloads: 0,
    },
    {
      name: 'foreign registry',
      overrides: { url: 'https://registry.invalid/package.tgz' },
      error: 'no Font Awesome registry packages',
      downloads: 0,
    },
    {
      name: 'unsafe package identity',
      overrides: { resolved: '@fortawesome/../escape@1.0.0' },
      error: 'Unexpected locked package identity',
      downloads: 0,
    },
    {
      name: 'mismatched archive digest',
      overrides: { integrity: `sha512-${Buffer.alloc(64).toString('base64')}` },
      error: 'Integrity mismatch',
      downloads: 1,
    },
    {
      name: 'archive outside the package directory',
      layout: 'outside',
      error: 'Unsafe package archive layout',
      downloads: 1,
    },
    {
      name: 'parent traversal in the archive',
      traversal: true,
      error: 'Unsafe package archive layout',
      downloads: 1,
    },
    {
      name: 'wrong extracted package identity',
      extractedName: '@fortawesome/other-icons',
      error: 'Extracted package identity mismatch',
      downloads: 1,
    },
  ])('rejects $name and cleans temporary files', (scenario) => {
    const cache = fixture(scenario);
    const result = cache.run('overrides' in scenario ? scenario.overrides : {});
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(scenario.error);
    expect(result.stdout).not.toContain('Primed');
    expect(cache.downloads()).toBe(scenario.downloads);
  });
});
