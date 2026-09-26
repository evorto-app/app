import { readFileSync } from 'node:fs';
import { getStaticYAMLValue, parseForESLint } from 'yaml-eslint-parser';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const readWorkflowRunSteps = (
  path: string,
  jobName: string,
  fixtureValue: string,
) => {
  const workflow = getStaticYAMLValue(
    parseForESLint(readFileSync(path, 'utf8')).ast,
  );
  if (!isRecord(workflow) || !isRecord(workflow['jobs']))
    throw new Error(`Invalid workflow ${path}`);
  const job = workflow['jobs'][jobName];
  if (!isRecord(job) || !Array.isArray(job['steps']))
    throw new Error(`Missing job ${jobName}`);
  return job['steps'].flatMap((step: unknown) => {
    if (!isRecord(step) || typeof step['run'] !== 'string') return [];
    const env: Record<string, string> = {};
    // Only declared names cross this boundary; all values are test fixtures.
    for (const scope of [workflow['env'], job['env'], step['env']]) {
      if (isRecord(scope))
        for (const name of Object.keys(scope)) env[name] = fixtureValue;
    }
    return [{ env, name: step['name'], script: step['run'] }];
  });
};

export const readWorkflowRunStep = (
  path: string,
  jobName: string,
  stepName: string,
  fixtureValue: string,
) => {
  const step = readWorkflowRunSteps(path, jobName, fixtureValue).find(
    (entry) => entry.name === stepName,
  );
  if (!step) throw new Error(`Missing executable guard ${stepName}`);
  return step;
};
