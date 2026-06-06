import { describe, expect, it } from '@effect/vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const helperPath = path.join(
  process.cwd(),
  'helpers/testing/ci-record-neon-local-metadata.sh',
);

const withTemporaryDirectory = (test: (root: string) => void): void => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evorto-neon-metadata-'));
  try {
    test(root);
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
};

describe('ci-record-neon-local-metadata.sh', () => {
  it('copies Neon Local metadata and summarizes unique branch ids', () => {
    withTemporaryDirectory((root) => {
      const metadataDirectory = path.join(root, 'metadata');
      const artifactDirectory = path.join(root, 'artifact');
      const summaryPath = path.join(root, 'summary.md');
      fs.mkdirSync(metadataDirectory);
      fs.writeFileSync(
        path.join(metadataDirectory, '.branches'),
        JSON.stringify({
          duplicate: { branch_id: 'br-test-123' },
          first: { branch_id: 'br-test-123' },
          second: { branch_id: 'br-test-456' },
        }),
      );

      const result = spawnSync('bash', [helperPath], {
        encoding: 'utf8',
        env: {
          ...process.env,
          GITHUB_STEP_SUMMARY: summaryPath,
          NEON_LOCAL_METADATA_ARTIFACT_DIR: artifactDirectory,
          NEON_LOCAL_METADATA_DIR: metadataDirectory,
        },
      });

      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.stdout).toContain(
        `Metadata artifact: \`${path.join(artifactDirectory, 'branches.json')}\``,
      );
      expect(result.stdout).toContain('Branch ids: br-test-123, br-test-456');
      expect(
        fs.readFileSync(path.join(artifactDirectory, 'branches.json'), 'utf8'),
      ).toContain('br-test-456');
      expect(fs.readFileSync(summaryPath, 'utf8')).toContain(
        'Branch ids: br-test-123, br-test-456',
      );
    });
  });

  it('succeeds without an artifact when metadata has not been written yet', () => {
    withTemporaryDirectory((root) => {
      const metadataDirectory = path.join(root, 'missing-metadata');
      const artifactDirectory = path.join(root, 'artifact');

      const result = spawnSync('bash', [helperPath], {
        encoding: 'utf8',
        env: {
          ...process.env,
          NEON_LOCAL_METADATA_ARTIFACT_DIR: artifactDirectory,
          NEON_LOCAL_METADATA_DIR: metadataDirectory,
        },
      });

      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.stdout).toContain(
        `No Neon Local branch metadata found at ${path.join(metadataDirectory, '.branches')}.`,
      );
      expect(fs.existsSync(path.join(artifactDirectory, 'branches.json'))).toBe(
        false,
      );
    });
  });
});
