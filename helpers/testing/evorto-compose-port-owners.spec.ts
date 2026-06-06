import { describe, expect, it } from '@effect/vitest';

import { findOtherEvortoComposePortOwnersFromDockerPs } from './evorto-compose-port-owners';

describe('findOtherEvortoComposePortOwnersFromDockerPs', () => {
  it('returns other Evorto Compose projects publishing the selected port', () => {
    const owners = findOtherEvortoComposePortOwnersFromDockerPs({
      currentComposeProjectName: 'evorto-current',
      dockerPsOutput: [
        JSON.stringify({
          Labels: 'com.docker.compose.project=evorto-current',
          Names: 'evorto-current-evorto-1',
          Ports: '0.0.0.0:4200->4200/tcp',
        }),
        JSON.stringify({
          Labels: 'com.docker.compose.project=evorto-other',
          Names: 'evorto-other-evorto-1',
          Ports: '0.0.0.0:4200->4200/tcp',
        }),
      ].join('\n'),
      hostPort: '4200',
    });

    expect(owners).toEqual([
      {
        name: 'evorto-other-evorto-1',
        project: 'evorto-other',
      },
    ]);
  });

  it('ignores unrelated projects, non-matching ports, and malformed rows', () => {
    const owners = findOtherEvortoComposePortOwnersFromDockerPs({
      currentComposeProjectName: 'evorto-current',
      dockerPsOutput: [
        'not-json',
        JSON.stringify({
          Labels: 'com.docker.compose.project=evorto-other',
          Names: 'evorto-other-evorto-1',
          Ports: '0.0.0.0:4300->4200/tcp',
        }),
        JSON.stringify({
          Labels: 'com.docker.compose.project=side-project',
          Names: 'side-project-app-1',
          Ports: '0.0.0.0:4200->4200/tcp',
        }),
      ].join('\n'),
      hostPort: '4200',
    });

    expect(owners).toEqual([]);
  });
});
