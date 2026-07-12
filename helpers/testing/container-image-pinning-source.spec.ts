import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));

const source = (relativePath: string): string =>
  readFileSync(path.join(repositoryRoot, relativePath), 'utf8');

const immutableTaggedImage = /^[^@\s]+:[^@\s]+@sha256:[a-f0-9]{64}$/u;

describe('container image pinning source', () => {
  it('pins every external Dockerfile and Compose image to a manifest digest', () => {
    const dockerfileStages = new Set<string>();
    const dockerfileImages = [
      ...source('Dockerfile').matchAll(
        /^FROM\s+(?:--platform=\S+\s+)?(\S+)(?:\s+AS\s+(\S+))?$/gimu,
      ),
    ].flatMap((match) => {
      const imageReference = match[1];
      const stageName = match[2];
      const externalImage =
        imageReference === undefined || dockerfileStages.has(imageReference)
          ? []
          : [imageReference];

      if (stageName !== undefined) {
        dockerfileStages.add(stageName);
      }

      return externalImage;
    });
    const composeImages = [
      ...source('docker-compose.yml').matchAll(/^\s+image:\s+(\S+)$/gmu),
    ].flatMap((match) => (match[1] === undefined ? [] : [match[1]]));
    const imageReferences = [...dockerfileImages, ...composeImages];

    expect(imageReferences).toHaveLength(7);
    for (const imageReference of imageReferences) {
      expect(imageReference, imageReference).toMatch(immutableTaggedImage);
      expect(imageReference, imageReference).not.toContain(':latest@');
    }
  });

  it('keeps Dependabot coverage for Dockerfiles and Compose', () => {
    const dependabot = source('.github/dependabot.yml');

    expect(dependabot).toContain('- package-ecosystem: "docker"');
    expect(dependabot).toContain('- package-ecosystem: "docker-compose"');
  });
});
