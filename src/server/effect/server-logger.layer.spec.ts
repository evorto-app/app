import { describe, expect, it } from '@effect/vitest';
import { Option } from 'effect';

import {
  resolveServerLogFormat,
  serverReleaseLogAnnotations,
} from './server-logger.layer';

describe('server logger', () => {
  it('uses readable local logs and structured container logs', () => {
    expect(resolveServerLogFormat('local')).toBe('pretty');
    expect(resolveServerLogFormat('staging')).toBe('json');
    expect(resolveServerLogFormat('production')).toBe('json');
  });

  it('attaches immutable release identity to every container log record', () => {
    expect(
      serverReleaseLogAnnotations({
        APP_BOOTSTRAP: false,
        APP_ENVIRONMENT: 'staging',
        APP_IMAGE_DIGEST: Option.some('sha256:digest'),
        APP_REVISION: Option.some('revision'),
        APP_ROLE: 'worker',
      }),
    ).toEqual({
      environment: 'staging',
      imageDigest: 'sha256:digest',
      revision: 'revision',
      role: 'worker',
    });
  });

  it('marks absent local release metadata explicitly', () => {
    expect(
      serverReleaseLogAnnotations({
        APP_BOOTSTRAP: false,
        APP_ENVIRONMENT: 'local',
        APP_IMAGE_DIGEST: Option.none(),
        APP_REVISION: Option.none(),
        APP_ROLE: 'web',
      }),
    ).toMatchObject({ imageDigest: 'unknown', revision: 'unknown' });
  });
});
