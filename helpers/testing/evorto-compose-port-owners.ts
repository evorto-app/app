export interface EvortoComposePortOwner {
  name: string;
  project: string;
}

const publishedPortExpression =
  /(?:^|[,\s])(?:0\.0\.0\.0|\[::\]|127\.0\.0\.1|\[::1\]|\*)?:(\d+)->/gu;

const extractPublishedHostPorts = (ports: unknown): readonly string[] => {
  if (typeof ports !== 'string') {
    return [];
  }

  return [...ports.matchAll(publishedPortExpression)].map((match) => match[1]);
};

export const findOtherEvortoComposePortOwnersFromDockerPs = ({
  currentComposeProjectName,
  dockerPsOutput,
  hostPort,
}: {
  currentComposeProjectName: string | undefined;
  dockerPsOutput: string;
  hostPort: string;
}): readonly EvortoComposePortOwner[] =>
  dockerPsOutput
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const parsed = JSON.parse(line) as {
          Labels?: unknown;
          Names?: unknown;
          Ports?: unknown;
        };
        const labels = String(parsed.Labels ?? '');
        const project = /(?:^|,)com\.docker\.compose\.project=([^,]+)/u.exec(
          labels,
        )?.[1];

        if (
          !project ||
          project === currentComposeProjectName ||
          !project.startsWith('evorto-') ||
          !extractPublishedHostPorts(parsed.Ports).includes(hostPort)
        ) {
          return [];
        }

        return [
          {
            name: String(parsed.Names ?? '').trim() || '<unnamed>',
            project,
          },
        ];
      } catch {
        return [];
      }
    });
