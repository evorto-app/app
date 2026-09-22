import { spawnSync } from 'node:child_process';

import { providerEnvironmentFromPrimaryCheckout } from './primary-provider-credentials';

const [command, ...args] = process.argv.slice(2);
if (!command) {
  throw new Error('Expected a command to run with local provider credentials');
}

const providerEnvironment = providerEnvironmentFromPrimaryCheckout({
  environment: process.env,
});
if (providerEnvironment.loadedNames.length > 0) {
  console.info(
    `Loaded local provider configuration from the primary checkout: ${providerEnvironment.loadedNames.join(', ')}`,
  );
}

const result = spawnSync(command, args, {
  env: providerEnvironment.environment,
  stdio: 'inherit',
});
if (result.error) throw result.error;
if (result.status !== 0) process.exitCode = result.status ?? 1;
