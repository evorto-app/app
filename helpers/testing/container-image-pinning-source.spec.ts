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

    expect(imageReferences).toHaveLength(8);
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

  it('updates operating-system packages only through pinned base images', () => {
    const dockerfile = source('Dockerfile');

    expect(dockerfile).not.toMatch(/\b(?:apt|apt-get|apk)\b/u);
  });

  it('keeps the production runtime distroless and starts Bun directly', () => {
    const dockerfile = source('Dockerfile');
    const compose = source('docker-compose.yml');
    const baselineWorkflow = source('.github/workflows/e2e-baseline.yml');
    const verifier = source('ops/scaleway/verify-runtime-image.sh');
    const productionStage = dockerfile.slice(
      dockerfile.indexOf('FROM distroless-runtime AS production'),
    );
    const evortoService = compose.match(
      /^ {2}evorto:[\s\S]*?(?=^ {2}worker:)/mu,
    )?.[0];
    const workerService = compose.match(
      /^ {2}worker:[\s\S]*?(?=^ {2}stripe:)/mu,
    )?.[0];

    expect(dockerfile).toContain(
      'FROM gcr.io/distroless/base-nossl-debian13:nonroot@sha256:',
    );
    expect(productionStage).toContain(
      'COPY --from=base /usr/local/bin/bun /usr/local/bin/bun',
    );
    expect(productionStage).toContain('USER 65532:65532');
    expect(productionStage).toContain('ENTRYPOINT ["/usr/local/bin/bun"]');
    expect(productionStage).toContain('CMD ["dist/evorto/server/server.mjs"]');
    expect(evortoService).toBeDefined();
    expect(evortoService).not.toContain('command:');
    expect(evortoService).not.toContain('server.log');
    expect(evortoService).not.toContain('mkfifo');
    expect(workerService).toBeDefined();
    expect(workerService).not.toContain('command:');
    expect(baselineWorkflow).not.toContain('/app/logs/server.log');
    expect(verifier).toContain("runtime_user}\" != '65532:65532'");
    expect(verifier).toContain(
      'runtime_entrypoint}" != \'["/usr/local/bin/bun"]\'',
    );
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

  it('excludes local secrets and Terraform working data from the build context', () => {
    const dockerIgnore = source('.dockerignore');

    for (const excludedPath of [
      '.env*',
      '**/.terraform',
      '**/*.tfstate',
      '**/*.tfstate.*',
      '**/*.tfplan',
      '**/backend.hcl',
      '**/terraform.tfvars',
      '**/*.auto.tfvars',
    ]) {
      expect(dockerIgnore).toContain(excludedPath);
    }

    for (const excludedPath of [
      'tests',
      '.e2e-runtime.json',
      '.playwright-cli',
      'coverage',
      'playwright-report',
      'test-results',
      'repos',
    ]) {
      expect(dockerIgnore).toMatch(
        new RegExp(`^${excludedPath.replaceAll('.', '\\.')}\\s*$`, 'mu'),
      );
    }
    for (const runtimeInput of ['helpers', 'ops', 'public', 'src']) {
      expect(dockerIgnore).not.toMatch(
        new RegExp(`^${runtimeInput}(?:/|\\s*$)`, 'mu'),
      );
    }
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
