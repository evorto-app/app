import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

type Environment = 'production' | 'staging';

const temporaryDirectories: string[] = [];
const environments: readonly Environment[] = ['staging', 'production'];
const schemaContents = 'export const schema = { version: "packaged" };\n';
const schemaHash = createHash('sha256').update(schemaContents).digest('hex');
const imageDigest = `sha256:${'a'.repeat(64)}`;
const imageReference = `registry.example.invalid/evorto@${imageDigest}`;

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

const packagedSchemaScript = (environment: Environment) => {
  const contents = fs.readFileSync(
    path.join(process.cwd(), `.github/workflows/scaleway-${environment}.yml`),
    'utf8',
  );
  const startMarker = '          docker pull --platform linux/amd64 ';
  const endMarker = '          } >> "${GITHUB_OUTPUT}"';
  const start = contents.indexOf(startMarker);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = contents.indexOf(endMarker, start);
  expect(end).toBeGreaterThan(start);
  const script = contents
    .slice(start, end + endMarker.length)
    .replaceAll(/^ {10}/gm, '')
    .replaceAll(
      '${{ steps.staging.outputs.schema_hash }}',
      '${EXPECTED_SCHEMA_HASH}',
    );
  expect(script).not.toContain('${{');
  return script;
};

const makeFixture = (environment: Environment) => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'evorto-packaged-schema-'),
  );
  temporaryDirectories.push(directory);
  const bin = path.join(directory, 'bin');
  const runnerTemp = path.join(directory, 'runner temp');
  const scriptsDirectory = path.join(directory, 'ops/scaleway');
  for (const target of [bin, runnerTemp, scriptsDirectory]) {
    fs.mkdirSync(target, { recursive: true });
  }
  const callLog = path.join(directory, 'calls.log');
  const output = path.join(directory, 'github-output');
  const schemaFile = path.join(directory, 'schema.mjs');
  fs.writeFileSync(callLog, '');
  fs.writeFileSync(output, '');
  fs.writeFileSync(schemaFile, schemaContents);
  fs.writeFileSync(
    path.join(bin, 'docker'),
    String.raw`#!/usr/bin/env bash
set -euo pipefail
case "$1" in
  pull|create)
    [ "$#" -eq 4 ]
    [ "$2" = --platform ]
    [ "$3" = linux/amd64 ]
    [ "$4" = "$EXPECTED_IMAGE_REFERENCE" ]
    printf '%s\n' "$1" >> "$CALL_LOG"
    if [ "$1" = create ]; then
      printf '%s\n' schema-container
    fi
    ;;
  cp)
    [ "$#" -eq 3 ]
    [ "$2" = schema-container:/app/dist/evorto/ops/schema.mjs ]
    [ "$3" = "$RUNNER_TEMP/packaged-schema.mjs" ]
    printf '%s\n' copy >> "$CALL_LOG"
    if [ "$COPY_FAILS" = true ]; then exit 42; fi
    cp "$SCHEMA_FIXTURE" "$3"
    ;;
  rm)
    [ "$#" -eq 2 ]
    [ "$2" = schema-container ]
    printf '%s\n' remove >> "$CALL_LOG"
    ;;
  *) exit 90 ;;
esac
`,
    { mode: 0o700 },
  );
  fs.writeFileSync(
    path.join(scriptsDirectory, 'verify-runtime-image.sh'),
    String.raw`#!/usr/bin/env bash
set -euo pipefail
[ "$#" -eq 1 ]
[ "$1" = "$EXPECTED_IMAGE_REFERENCE" ]
printf '%s\n' verify >> "$CALL_LOG"
if [ "$VERIFIER_FAILS" = true ]; then exit 43; fi
`,
    { mode: 0o700 },
  );
  const script = packagedSchemaScript(environment);

  return {
    calls: () => fs.readFileSync(callLog, 'utf8').trim().split('\n'),
    output: () => fs.readFileSync(output, 'utf8'),
    packagedSchemaExists: () =>
      fs.existsSync(path.join(runnerTemp, 'packaged-schema.mjs')),
    run: (
      options: {
        copyFails?: boolean;
        expectedSchemaHash?: string;
        verifierFails?: boolean;
      } = {},
    ) =>
      spawnSync(
        'bash',
        ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', script],
        {
          cwd: directory,
          encoding: 'utf8',
          env: {
            CALL_LOG: callLog,
            COPY_FAILS: String(options.copyFails ?? false),
            EXPECTED_IMAGE_REFERENCE: imageReference,
            EXPECTED_SCHEMA_HASH: options.expectedSchemaHash ?? schemaHash,
            GITHUB_OUTPUT: output,
            PATH: `${bin}${path.delimiter}${process.env['PATH'] ?? ''}`,
            REUSE: 'true',
            RUNNER_TEMP: runnerTemp,
            SCHEMA_FIXTURE: schemaFile,
            VERIFIER_FAILS: String(options.verifierFails ?? false),
            digest: imageDigest,
            image_reference: imageReference,
            sbom_key: 'sbom.json',
            schema_hash: options.expectedSchemaHash ?? schemaHash,
            source_maps_key: 'source-maps.tar.gz',
            target_digest: imageDigest,
            target_reference: imageReference,
          },
          timeout: 10_000,
        },
      ),
  };
};

describe('Scaleway packaged schema hashing', () => {
  for (const environment of environments) {
    it(`hashes the verified ${environment} image schema on the host`, () => {
      const fixture = makeFixture(environment);
      const result = fixture.run();
      expect(result.status, result.stderr).toBe(0);
      expect(fixture.calls()).toEqual([
        'pull',
        'verify',
        'create',
        'copy',
        'remove',
      ]);
      expect(fixture.output()).toContain(`digest=${imageDigest}\n`);
      expect(fixture.output()).toContain(`reference=${imageReference}\n`);
      if (environment === 'staging') {
        expect(fixture.output()).toContain(`schema_hash=${schemaHash}\n`);
      }
      expect(fixture.packagedSchemaExists()).toBe(false);
    });

    it(`rejects a ${environment} schema that differs from the accepted manifest`, () => {
      const fixture = makeFixture(environment);
      const result = fixture.run({ expectedSchemaHash: 'b'.repeat(64) });
      expect(result.status, result.stderr).not.toBe(0);
      expect(result.stdout).toContain('::error::');
      expect(fixture.calls()).toEqual([
        'pull',
        'verify',
        'create',
        'copy',
        'remove',
      ]);
      expect(fixture.output()).toBe('');
      expect(fixture.packagedSchemaExists()).toBe(false);
    });

    it(`stops ${environment} before publishing outputs when schema extraction fails`, () => {
      const fixture = makeFixture(environment);
      const result = fixture.run({ copyFails: true });
      expect(result.status, result.stderr).toBe(42);
      expect(fixture.calls()).toEqual(['pull', 'verify', 'create', 'copy']);
      expect(fixture.output()).toBe('');
    });

    it(`stops ${environment} before extraction when image verification fails`, () => {
      const fixture = makeFixture(environment);
      const result = fixture.run({ verifierFails: true });
      expect(result.status, result.stderr).toBe(43);
      expect(fixture.calls()).toEqual(['pull', 'verify']);
      expect(fixture.output()).toBe('');
    });
  }
});
