import { describe, expect, it } from '@effect/vitest';

import { resolveRuntimePorts } from './runtime-environment';

describe('runtime environment ports', () => {
  it('keeps generated ports unique across many seeds, including a former MinIO collision', () => {
    const seeds = [
      // The previous overlapping ranges assigned both MinIO ports to 9235.
      '288',
      ...Array.from({ length: 10_000 }, (_, index) => `worktree-${index}`),
    ];

    for (const seed of seeds) {
      const ports = resolveRuntimePorts(seed, {});

      expect(new Set(Object.values(ports)).size, seed).toBe(4);
      expect(ports.minioHostPort, seed).toBeGreaterThanOrEqual(9000);
      expect(ports.minioHostPort, seed).toBeLessThan(9400);
      expect(ports.minioConsoleHostPort, seed).toBeGreaterThanOrEqual(9400);
      expect(ports.minioConsoleHostPort, seed).toBeLessThan(9800);
    }
  });

  it('preserves valid explicit port overrides', () => {
    expect(
      resolveRuntimePorts('explicit-overrides', {
        APP_HOST_PORT: '4300',
        MINIO_CONSOLE_HOST_PORT: '9800',
        MINIO_HOST_PORT: '9300',
        NEON_LOCAL_HOST_PORT: '56000',
      }),
    ).toEqual({
      appHostPort: 4300,
      minioConsoleHostPort: 9800,
      minioHostPort: 9300,
      neonLocalHostPort: 56_000,
    });
  });

  it('fails clearly when explicit overrides reuse a host port', () => {
    expect(() =>
      resolveRuntimePorts('conflicting-overrides', {
        MINIO_CONSOLE_HOST_PORT: '9300',
        MINIO_HOST_PORT: '9300',
      }),
    ).toThrow(
      'Runtime ports must be unique: 9300 is assigned to minioConsoleHostPort, minioHostPort',
    );
  });
});
