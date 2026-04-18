import consola from 'consola';

const DEFAULT_LOCAL_LEVEL = 3;
const DEFAULT_CI_LEVEL = 2;
const DEBUG_LEVEL = 4;
const MAX_CONSOLA_LEVEL = 4;
const MIN_CONSOLA_LEVEL = 0;

const isTruthy = (value: string | undefined): boolean =>
  value?.toLowerCase() === 'true' || value === '1';

const parseConsolaLevel = (value: string | undefined): number | undefined => {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value.trim(), 10);
  if (!Number.isInteger(parsed)) {
    return undefined;
  }

  return Math.min(MAX_CONSOLA_LEVEL, Math.max(MIN_CONSOLA_LEVEL, parsed));
};

export const resolveTestConsolaLevel = (
  input: NodeJS.ProcessEnv = process.env,
): number => {
  const explicitLevel = parseConsolaLevel(input['E2E_LOG_LEVEL']);
  if (explicitLevel !== undefined) {
    return explicitLevel;
  }

  if (
    isTruthy(input['E2E_DEBUG_LOGS']) ||
    isTruthy(input['ACTIONS_STEP_DEBUG'])
  ) {
    return DEBUG_LEVEL;
  }

  return isTruthy(input['CI']) ? DEFAULT_CI_LEVEL : DEFAULT_LOCAL_LEVEL;
};

export const applyTestConsolaLevel = (
  input: NodeJS.ProcessEnv = process.env,
): number => {
  const level = resolveTestConsolaLevel(input);
  consola.level = level;
  return level;
};
