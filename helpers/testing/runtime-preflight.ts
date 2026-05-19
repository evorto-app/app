type RuntimeTarget = 'docker';

type RequiredVariable = {
  description: string;
  name: string;
};

const requiredByTarget = {
  docker: [
    {
      description: 'Font Awesome package registry access for premium icons',
      name: 'FONT_AWESOME_TOKEN',
    },
    {
      description: 'Neon Local branch creation',
      name: 'NEON_API_KEY',
    },
    {
      description: 'Neon Local project selection',
      name: 'NEON_PROJECT_ID',
    },
    {
      description: 'Auth0 application id',
      name: 'CLIENT_ID',
    },
    {
      description: 'Auth0 application secret',
      name: 'CLIENT_SECRET',
    },
    {
      description: 'Auth0 issuer URL',
      name: 'ISSUER_BASE_URL',
    },
    {
      description: 'Application session secret',
      name: 'SECRET',
    },
    {
      description: 'Stripe API access for paid registration flows',
      name: 'STRIPE_API_KEY',
    },
    {
      description: 'Stripe webhook signature verification',
      name: 'STRIPE_WEBHOOK_SECRET',
    },
  ],
} satisfies Record<RuntimeTarget, RequiredVariable[]>;

const targets = new Set<RuntimeTarget>(['docker']);

const readTarget = (): RuntimeTarget => {
  const target = process.argv[2];
  if (targets.has(target as RuntimeTarget)) {
    return target as RuntimeTarget;
  }

  console.error(
    `Usage: bun helpers/testing/runtime-preflight.ts ${Array.from(targets).join('|')}`,
  );
  process.exit(2);
};

const isPresent = (name: string): boolean => {
  const value = process.env[name];
  return value !== undefined && value.trim().length > 0;
};

const target = readTarget();
const missing = requiredByTarget[target].filter(({ name }) => !isPresent(name));

if (missing.length > 0) {
  console.error(`Missing required ${target} runtime variables:`);
  for (const { description, name } of missing) {
    console.error(`- ${name}: ${description}`);
  }
  console.error(
    'Add secret values to .env or export them in the shell, then rerun the package script.',
  );
  process.exit(1);
}

console.log(`Runtime preflight passed for ${target}.`);
