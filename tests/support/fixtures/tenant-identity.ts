export const fixtureOrganizationName = 'North River Student Network';

export const parallelOrganizationDomain = (runId: string): string => {
  const numericRunId = Number.parseInt(runId, 16);
  if (!Number.isSafeInteger(numericRunId)) {
    throw new Error(`Expected a hexadecimal fixture run ID, received ${runId}`);
  }

  const suffix = 10_000_000 + (numericRunId % 90_000_000);
  return `north-river-${suffix}.evorto.app`;
};
