import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

interface NeonBranch {
  created_at?: unknown;
  default?: unknown;
  expires_at?: unknown;
  id?: unknown;
  name?: unknown;
  primary?: unknown;
}

type NeonLocalBranchState = Record<string, { branch_id?: unknown }>;

const apiKey = process.env['NEON_API_KEY']?.trim();
const projectId = process.env['NEON_PROJECT_ID']?.trim();
const existingBranchId = process.env['BRANCH_ID']?.trim();
const deleteBranch = process.env['DELETE_BRANCH']?.trim().toLowerCase();
const forceDeleteBranchIdsValue =
  process.env['NEON_LOCAL_FORCE_DELETE_BRANCH_IDS']?.trim();
const ttlHoursValue = process.env['NEON_LOCAL_BRANCH_TTL_HOURS']?.trim();
const dryRun = process.argv.includes('--dry-run');

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

const ttlHours = Math.min(parsePositiveInteger(ttlHoursValue, 2), 720);

const forceDeleteBranchIds = [
  ...new Set(
    (forceDeleteBranchIdsValue ?? '')
      .split(',')
      .map((branchId) => branchId.trim())
      .filter(Boolean),
  ),
];

const assertNeonApiConfig = (): void => {
  if (!apiKey) {
    throw new Error('NEON_API_KEY is required to delete Neon Local branches');
  }

  if (!projectId) {
    throw new Error(
      'NEON_PROJECT_ID is required to delete Neon Local branches',
    );
  }
};

const readBranchState = async (): Promise<NeonLocalBranchState> => {
  const raw = await readFile(metadataPath, 'utf8');
  const parsed: unknown = JSON.parse(raw);

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Unexpected Neon Local branch metadata at ${metadataPath}`);
  }

  return parsed as NeonLocalBranchState;
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

const listNeonBranches = async (): Promise<NeonBranch[]> => {
  const response = await fetch(
    `https://console.neon.tech/api/v2/projects/${projectId}/branches`,
    {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Failed to list Neon branches for stale cleanup: ${response.status} ${body}`,
    );
  }

  const payload: unknown = await response.json();
  if (
    typeof payload !== 'object' ||
    payload === null ||
    !Array.isArray((payload as { branches?: unknown }).branches)
  ) {
    throw new Error('Unexpected Neon branches list response shape');
  }

  return (payload as { branches: NeonBranch[] }).branches;
};

const isProtectedBranch = (branch: NeonBranch): boolean =>
  branch.default === true || branch.primary === true || branch.name === 'main';

const extractStaleEphemeralBranchId = (
  branch: NeonBranch,
  now: Date,
): string | undefined => {
  if (isProtectedBranch(branch)) {
    return undefined;
  }

  if (typeof branch.id !== 'string' || !branch.id.trim()) {
    return undefined;
  }

  if (typeof branch.expires_at === 'string' && branch.expires_at.trim()) {
    const expiresAt = new Date(branch.expires_at);
    if (!Number.isNaN(expiresAt.getTime()) && expiresAt <= now) {
      return branch.id.trim();
    }

    return undefined;
  }

  if (typeof branch.created_at !== 'string' || !branch.created_at.trim()) {
    return undefined;
  }

  const createdAt = new Date(branch.created_at);
  const staleAfter = new Date(now.getTime() - ttlHours * 60 * 60 * 1000);
  if (Number.isNaN(createdAt.getTime()) || createdAt > staleAfter) {
    return undefined;
  }

  return branch.id.trim();
};

const isString = (value: string | undefined): value is string =>
  value !== undefined;

const summarizeBranch = (branch: NeonBranch, now: Date): string => {
  const name = typeof branch.name === 'string' ? branch.name : '<unnamed>';
  const id = typeof branch.id === 'string' ? branch.id : '<missing-id>';
  const createdAt =
    typeof branch.created_at === 'string' && branch.created_at.trim()
      ? branch.created_at
      : '<unknown-created-at>';
  const ageMinutes =
    typeof branch.created_at === 'string'
      ? Math.max(
          0,
          Math.floor(
            (now.getTime() - new Date(branch.created_at).getTime()) / 60_000,
          ),
        )
      : undefined;

  return ageMinutes === undefined || Number.isNaN(ageMinutes)
    ? `${name} (${id}, created_at=${createdAt})`
    : `${name} (${id}, age=${ageMinutes}m, created_at=${createdAt})`;
};

const logBranchCleanupSummary = (
  branches: NeonBranch[],
  staleBranchIds: string[],
  now: Date,
): void => {
  const protectedBranchCount = branches.filter((branch) =>
    isProtectedBranch(branch),
  ).length;
  const staleBranchIdSet = new Set(staleBranchIds);
  const activeEphemeralBranches = branches.filter(
    (branch) =>
      !isProtectedBranch(branch) &&
      typeof branch.id === 'string' &&
      !staleBranchIdSet.has(branch.id),
  );

  console.log(
    `Neon branch cleanup summary: total=${branches.length}, protected=${protectedBranchCount}, active_test=${activeEphemeralBranches.length}, stale_deleted=${staleBranchIds.length}, ttl=${ttlHours}h.`,
  );

  if (activeEphemeralBranches.length > 0) {
    console.log(
      `Active Neon Local branches still inside the ${ttlHours}h active-test TTL:`,
    );
    for (const branch of activeEphemeralBranches) {
      console.log(`- ${summarizeBranch(branch, now)}`);
    }
  }
};

const deleteBranchById = async (branchId: string): Promise<void> => {
  if (dryRun) {
    console.log(`Dry run: would delete Neon Local branch ${branchId}.`);
    return;
  }

  const response = await fetch(
    `https://console.neon.tech/api/v2/projects/${projectId}/branches/${branchId}`,
    {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      method: 'DELETE',
    },
  );

  if (response.status === 404) {
    console.log(
      `Neon Local branch ${branchId} is already absent after Docker shutdown.`,
    );
    return;
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Failed to delete Neon Local branch ${branchId}: ${response.status} ${body}`,
    );
  }

  console.log(`Deleted Neon Local branch ${branchId}.`);
};

const deleteStaleEphemeralBranches = async (): Promise<void> => {
  if (!apiKey || !projectId) {
    console.log(
      'NEON_API_KEY and NEON_PROJECT_ID are required for Neon Local stale cleanup; skipping stale cleanup.',
    );
    return;
  }

  const now = new Date();
  const branches = await listNeonBranches();
  const staleBranchIds = branches
    .map((branch) => extractStaleEphemeralBranchId(branch, now))
    .filter(isString);

  if (staleBranchIds.length === 0) {
    console.log(
      `No stale Neon Local branches found outside the ${ttlHours}h active-test TTL.`,
    );
    logBranchCleanupSummary(branches, staleBranchIds, now);
    return;
  }

  for (const branchId of staleBranchIds) {
    await deleteBranchById(branchId);
  }

  const remainingBranches = dryRun ? branches : await listNeonBranches();
  logBranchCleanupSummary(remainingBranches, dryRun ? [] : staleBranchIds, now);
  if (dryRun) {
    console.log(
      `Dry run: ${staleBranchIds.length} stale Neon Local branch(es) would be deleted.`,
    );
  }
};

const deleteExplicitBranchIds = async (): Promise<void> => {
  if (forceDeleteBranchIds.length === 0) {
    return;
  }

  assertNeonApiConfig();

  const branches = await listNeonBranches();
  const branchesById = new Map(
    branches
      .filter(
        (branch): branch is NeonBranch & { id: string } =>
          typeof branch.id === 'string',
      )
      .map((branch) => [branch.id, branch]),
  );

  for (const branchId of forceDeleteBranchIds) {
    const branch = branchesById.get(branchId);
    if (!branch) {
      console.log(`Requested Neon Local branch ${branchId} is already absent.`);
      continue;
    }

    if (isProtectedBranch(branch)) {
      throw new Error(
        `Refusing to force-delete protected Neon branch ${summarizeBranch(
          branch,
          new Date(),
        )}.`,
      );
    }

    await deleteBranchById(branchId);
  }
};

const main = async (): Promise<void> => {
  await deleteExplicitBranchIds();

  if (existingBranchId) {
    console.log(
      `BRANCH_ID=${existingBranchId} connects Neon Local to an existing branch; skipping cleanup.`,
    );
    return;
  }

  if (deleteBranch === 'false') {
    console.log(
      'DELETE_BRANCH=false requests a persistent branch; skipping cleanup.',
    );
    return;
  }

  if (!existsSync(metadataPath)) {
    console.log(
      `No Neon Local branch metadata found at ${metadataPath}; checking for stale Neon Local branches outside the ${ttlHours}h active-test TTL.`,
    );
    await deleteStaleEphemeralBranches();
    return;
  }

  assertNeonApiConfig();

  const state = await readBranchState();
  const branchIds = extractBranchIds(state);

  if (branchIds.length === 0) {
    console.log(
      `No Neon Local branch ids found in ${metadataPath}; checking for stale Neon Local branches outside the ${ttlHours}h active-test TTL.`,
    );
    await deleteStaleEphemeralBranches();
    return;
  }

  for (const branchId of branchIds) {
    await deleteBranchById(branchId);
  }

  await deleteStaleEphemeralBranches();
};

try {
  await main();
} catch (error: unknown) {
  console.error(error);
  process.exitCode = 1;
}
