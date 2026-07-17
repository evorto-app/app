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
        imageReference === undefined ||
        imageReference === 'scratch' ||
        dockerfileStages.has(imageReference)
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

  it('exports private source maps but removes them from the runtime image', () => {
    const dockerfile = source('Dockerfile');
    const verifier = source('ops/scaleway/verify-runtime-image.sh');

    expect(dockerfile).toContain('FROM scratch AS source-maps');
    expect(dockerfile).toContain('FROM build AS runtime-artifacts');
    expect(dockerfile).toContain("find dist -type f -name '*.map' -delete");
    expect(dockerfile).toContain(
      'COPY --from=runtime-artifacts /app/dist ./dist',
    );
    expect(verifier).toContain('maximum_size_bytes=1000000000');
    expect(verifier).toContain('|\\.map$');
    expect(verifier).toContain('@neondatabase');
    expect(verifier).toContain('api\\.resend\\.com');
  });

  it('verifies locked private package integrity before the frozen image install', () => {
    const dockerfile = source('Dockerfile');
    const cachePrimer = source('ops/scaleway/prime-bun-fontawesome-cache.mjs');

    expect(dockerfile).toContain(
      'node ops/scaleway/prime-bun-fontawesome-cache.mjs bun.lock /home/bun/.bun/install/cache',
    );
    expect(dockerfile).toContain('bun install --frozen-lockfile');
    expect(dockerfile).not.toContain(
      'COPY --from=runtime-artifacts /app/ops ./ops',
    );
    expect(cachePrimer).toContain('url.hostname !== "npm.fontawesome.com"');
    expect(cachePrimer).toContain('createHash("sha512")');
    expect(cachePrimer).toContain('actualIntegrity !== integrity');
    expect(cachePrimer).toContain('segments.includes("..")');
  });
});
