import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

type NeonLocalBranchState = Record<string, { branch_id?: unknown }>;

const apiKey = process.env['NEON_API_KEY']?.trim();
const projectId = process.env['NEON_PROJECT_ID']?.trim();
const existingBranchId = process.env['BRANCH_ID']?.trim();
const deleteBranch = process.env['DELETE_BRANCH']?.trim().toLowerCase();
const ttlHoursValue = process.env['NEON_LOCAL_BRANCH_TTL_HOURS']?.trim();
const waitSecondsValue =
  process.env['NEON_LOCAL_METADATA_WAIT_SECONDS']?.trim();

const metadataDirectory =
  process.env['NEON_LOCAL_METADATA_DIR']?.trim() || '/tmp/.neon_local';
const metadataPath = path.join(metadataDirectory, '.branches');

const parsePositiveInteger = (
  value: string | undefined,
  fallback: number,
): number => {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
};

const ttlHours = Math.min(parsePositiveInteger(ttlHoursValue, 24), 720);
const waitSeconds = parsePositiveInteger(waitSecondsValue, 60);

const sleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const readBranchState = async (): Promise<NeonLocalBranchState> => {
  const raw = await readFile(metadataPath, 'utf8');
  const parsed: unknown = JSON.parse(raw);

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Unexpected Neon Local branch metadata at ${metadataPath}`);
  }

  return parsed as NeonLocalBranchState;
};

const waitForBranchState = async (): Promise<NeonLocalBranchState> => {
  const deadline = Date.now() + waitSeconds * 1000;
  let lastError: unknown;

  while (Date.now() <= deadline) {
    try {
      if (existsSync(metadataPath)) {
        const state = await readBranchState();
        const branchIds = extractBranchIds(state);
        if (branchIds.length > 0) {
          return state;
        }
      }
    } catch (error) {
      lastError = error;
    }

    await sleep(1000);
  }

  if (lastError instanceof Error) {
    throw lastError;
  }

  throw new Error(
    `Timed out waiting for Neon Local branch metadata at ${metadataPath}`,
  );
};

const extractBranchIds = (state: NeonLocalBranchState): string[] => {
  const branchIds = new Set<string>();

  for (const value of Object.values(state)) {
    const branchId = value.branch_id;
    if (typeof branchId === 'string' && branchId.trim()) {
      branchIds.add(branchId.trim());
    }
  }

  return [...branchIds];
};

const setBranchExpiration = async (
  branchId: string,
  expiresAt: string,
): Promise<void> => {
  const response = await fetch(
    `https://console.neon.tech/api/v2/projects/${projectId}/branches/${branchId}`,
    {
      body: JSON.stringify({ branch: { expires_at: expiresAt } }),
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      method: 'PATCH',
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Failed to set Neon branch expiration for ${branchId}: ${response.status} ${body}`,
    );
  }
};

const main = async (): Promise<void> => {
  if (existingBranchId) {
    console.log(
      `BRANCH_ID=${existingBranchId} connects Neon Local to an existing branch; skipping expiration update.`,
    );
    return;
  }

  if (deleteBranch === 'false') {
    console.log(
      'DELETE_BRANCH=false requests a persistent branch; skipping expiration update.',
    );
    return;
  }

  if (!apiKey) {
    throw new Error('NEON_API_KEY is required to set Neon branch expiration');
  }

  if (!projectId) {
    throw new Error(
      'NEON_PROJECT_ID is required to set Neon branch expiration',
    );
  }

  const state = await waitForBranchState();
  const branchIds = extractBranchIds(state);
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000)
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z');

  for (const branchId of branchIds) {
    await setBranchExpiration(branchId, expiresAt);
    console.log(
      `Set Neon Local branch ${branchId} to expire at ${expiresAt} (${ttlHours}h TTL).`,
    );
  }
};

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
