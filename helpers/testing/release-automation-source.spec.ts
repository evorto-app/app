import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));

const readSource = (relativePath: string): string =>
  readFileSync(path.join(repositoryRoot, relativePath), 'utf8');

const changeFilePaths = readdirSync(path.join(repositoryRoot, '.changeset'))
  .filter((fileName) => fileName.endsWith('.md'))
  .sort()
  .map((fileName) => `.changeset/${fileName}`);

describe('release automation source', () => {
  it('prepares format-preserving draft releases from explicit change files', () => {
    const knopeConfig = readSource('knope.toml');
    const packageManifest = readSource('package.json');
    const packageJson = JSON.parse(packageManifest) as {
      scripts: Record<string, string>;
    };
    const localValidation = readSource('helpers/testing/validate-knope.sh');
    const versionPattern = String.raw`(?m)^  "version": "(?<version>\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)"`;

    expect(knopeConfig).toContain(
      `{ path = "package.json", regex = '${versionPattern}' }`,
    );
    expect(knopeConfig).not.toContain('versioned_files = ["package.json"]');
    expect(knopeConfig).toContain('assets = []');
    expect(knopeConfig).toContain(
      '[changes]\nignore_conventional_commits = true',
    );
    expect(knopeConfig).toContain('[bot.releases]\nenabled = true');
    expect(packageManifest.endsWith('\n')).toBe(true);
    expect(packageJson.scripts['release:validate']).toBe(
      'bash helpers/testing/validate-knope.sh',
    );
    expect(localValidation).toContain("readonly knope_version='0.23.0'");
    expect(localValidation).toContain(
      'https://github.com/knope-dev/knope/releases/download/',
    );
    expect(localValidation).toContain('sha256sum "${archive_path}"');
    expect(localValidation).toContain(
      'shasum --algorithm 256 "${archive_path}"',
    );
    expect(localValidation).toContain(
      'actual_archive_sha256}" != "${archive_sha256}',
    );
    expect(localValidation).toContain('exec "${knope_binary}" --validate');

    expect(changeFilePaths.length).toBeGreaterThan(0);
    for (const changeFilePath of changeFilePaths) {
      const changeFile = readSource(changeFilePath);
      const frontmatter = changeFile.split('\n').slice(0, 3);

      expect(frontmatter, changeFilePath).toEqual([
        '---',
        expect.stringMatching(/^default: (?:major|minor|patch)$/u),
        '---',
      ]);
      expect(changeFile, changeFilePath).not.toMatch(/^"?evorto"?:/mu);
    }
  });

  it('publishes only the exact Knope draft that passed provider certification', () => {
    const workflow = readSource('.github/workflows/release.yml');
    const providerJobStart = workflow.indexOf('  provider-certification:');
    const releaseJobStart = workflow.indexOf('  release:');
    const releaseJob = workflow.slice(releaseJobStart);

    expect(providerJobStart).toBeGreaterThan(0);
    expect(releaseJobStart).toBeGreaterThan(providerJobStart);
    expect(workflow).not.toContain('workflow_dispatch:');
    expect(workflow).not.toContain('Release hook placeholder');
    expect(workflow).not.toContain('knope release');
    expect(workflow.toLowerCase()).not.toContain('fly');

    expect(releaseJob).toContain('name: Publish certified GitHub release');
    expect(releaseJob).toContain('needs: provider-certification');
    expect(releaseJob).toContain(
      'permissions:\n      actions: read\n      contents: write',
    );
    expect(releaseJob).toContain('fetch-depth: 0');
    expect(releaseJob).toContain(
      'ref: ${{ github.event.pull_request.merge_commit_sha }}',
    );
    expect(releaseJob).toContain(
      'EXPECTED_RELEASE_SHA: ${{ github.event.pull_request.merge_commit_sha }}',
    );
    expect(releaseJob).toContain('.draft == true');
    expect(releaseJob).toContain('and test("^[0-9]+\\\\.[0-9]+\\\\.[0-9]+$")');
    expect(releaseJob).not.toContain('(?:-[0-9A-Za-z.-]+)?');
    expect(releaseJob).toContain(
      'release_sha="$(git rev-parse "${tag}^{commit}")"',
    );
    expect(releaseJob).toContain(
      'gh release edit "${tag}" --draft=false --latest --verify-tag',
    );
    expect(releaseJob).toContain(
      "jq -er 'select(.draft == false and .prerelease == false) | .html_url'",
    );
    expect(releaseJob).not.toContain(
      "--jq 'select(.draft == false and .prerelease == false) | .html_url'",
    );
  });

  it('requires successful main quality runs for the exact release SHA before publishing', () => {
    const workflow = readSource('.github/workflows/release.yml');
    const releaseJob = workflow.slice(workflow.indexOf('  release:'));
    const qualityGateStart = releaseJob.indexOf(
      '- name: Require successful quality workflows for the release SHA',
    );
    const publishStepStart = releaseJob.indexOf(
      '- name: Verify and publish the certified Knope draft',
    );
    const releaseEditStart = releaseJob.indexOf(
      'gh release edit "${tag}" --draft=false --latest --verify-tag',
    );
    const qualityGate = releaseJob.slice(qualityGateStart, publishStepStart);
    const failedRunCase = qualityGate.slice(
      qualityGate.indexOf('completed:*)'),
      qualityGate.indexOf('                *)'),
    );

    expect(qualityGateStart).toBeGreaterThan(0);
    expect(publishStepStart).toBeGreaterThan(qualityGateStart);
    expect(releaseEditStart).toBeGreaterThan(qualityGateStart);
    expect(releaseJob).toContain('actions: read');
    expect(qualityGate).toContain(
      'EXPECTED_RELEASE_SHA: ${{ github.event.pull_request.merge_commit_sha }}',
    );
    expect(qualityGate).toContain('pr-quality.yml:PR Quality');
    expect(qualityGate).toContain('e2e-baseline.yml:E2E Baseline');
    expect(qualityGate).toContain('head_sha=${EXPECTED_RELEASE_SHA}');
    expect(qualityGate).toContain('event=push');
    expect(qualityGate).toContain('.head_sha == $sha');
    expect(qualityGate).toContain('.head_branch == "main"');
    expect(qualityGate).toContain('.event == "push"');
    expect(qualityGate).toContain('completed:success');
    expect(qualityGate).toContain('completed:*');
    expect(failedRunCase).toContain('exit 1');
    expect(qualityGate).toContain(
      'Timed out waiting for required quality workflows',
    );
  });

  it('keeps pending release notes aligned with current local test policy', () => {
    const pendingReleaseNotes = changeFilePaths.map(readSource).join('\n');

    expect(pendingReleaseNotes).not.toContain('temporarily skip');
    expect(pendingReleaseNotes).not.toContain('.env.development');
    expect(pendingReleaseNotes).toContain(
      'require every collected functional and documentation test to pass',
    );
  });
});
