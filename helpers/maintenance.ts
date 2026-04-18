import path from 'node:path';

import {
  CommandLineError,
  CommandSpec,
  fail,
  runCommandsSequentially,
} from './cli/runtime-command';

interface MaintenanceTask {
  commands: CommandSpec[];
  description: string;
}

const cleanupReceiptImagesPath = path.resolve(
  process.cwd(),
  'helpers/cleanup-testing-receipt-images.ts',
);
const playwrightCliPath = path.resolve(process.cwd(), 'node_modules/playwright/cli.js');
const sentryCliPath = path.resolve(process.cwd(), 'node_modules/.bin/sentry-cli');

const tasks: Record<string, MaintenanceTask> = {
  'deps:update:angular': {
    commands: [
      {
        cmd: [
          process.execPath,
          'x',
          '--bun',
          'ng',
          'update',
          '@angular/cli',
          '@angular/cdk',
          '@angular/core',
          '@angular/material',
          'angular-eslint',
          '--allow-dirty',
        ],
      },
    ],
    description: 'Update Angular and Angular-adjacent packages with ng update.',
  },
  'deps:update:drizzle': {
    commands: [
      {
        cmd: [process.execPath, 'add', 'drizzle-orm@beta'],
      },
      {
        cmd: [
          process.execPath,
          'add',
          '-D',
          'drizzle-seed@beta',
          'drizzle-kit@beta',
        ],
      },
    ],
    description: 'Update Drizzle ORM, Drizzle Kit, and drizzle-seed to beta.',
  },
  'ops:sentry:sourcemaps': {
    commands: [
      {
        cmd: [
          sentryCliPath,
          'sourcemaps',
          'inject',
          '--org',
          'lukas-heddendorp',
          '--project',
          'evorto',
          './dist',
        ],
      },
      {
        cmd: [
          sentryCliPath,
          'sourcemaps',
          'upload',
          '--org',
          'lukas-heddendorp',
          '--project',
          'evorto',
          './dist',
        ],
      },
    ],
    description: 'Inject and upload Sentry sourcemaps for the built dist output.',
  },
  'ops:stripe:listen': {
    commands: [
      {
        cmd: ['stripe', 'listen', '--forward-to', 'http://localhost:4200/webhooks/stripe'],
      },
    ],
    description: 'Forward local Stripe webhooks to the app.',
  },
  'playwright:report': {
    commands: [
      {
        cmd: [process.execPath, playwrightCliPath, 'show-report'],
      },
    ],
    description: 'Open the Playwright HTML report.',
  },
  'test:cleanup:receipt-images': {
    commands: [
      {
        cmd: [process.execPath, cleanupReceiptImagesPath],
      },
    ],
    description: 'Remove generated testing receipt images.',
  },
  'test:cleanup:receipt-images:dry-run': {
    commands: [
      {
        cmd: [process.execPath, cleanupReceiptImagesPath, '--dry-run'],
      },
    ],
    description: 'Preview generated testing receipt image cleanup without deleting files.',
  },
  'ui:theme:generate': {
    commands: [
      {
        cmd: [
          process.execPath,
          'x',
          '--bun',
          'ng',
          'generate',
          '@angular/material:theme-color',
          '--include-high-contrast',
          '--primary-color=#0891b2',
          '--interactive=false',
          '--directory=src/',
          '--force',
        ],
      },
    ],
    description: 'Regenerate the default Angular Material theme color assets.',
  },
  'ui:theme:generate:esn': {
    commands: [
      {
        cmd: [
          process.execPath,
          'x',
          '--bun',
          'ng',
          'generate',
          '@angular/material:theme-color',
          '--include-high-contrast',
          '--primary-color=#00aeef',
          '--secondary-color=#ec008c',
          '--tertiary-color=#7ac143',
          '--interactive=false',
          '--directory=src/_esn',
          '--force',
        ],
      },
    ],
    description: 'Regenerate the ESN-specific Angular Material theme color assets.',
  },
};

const printTaskList = () => {
  console.log('Maintenance tasks:');

  for (const [name, task] of Object.entries(tasks).toSorted(([left], [right]) =>
    left.localeCompare(right),
  )) {
    console.log(`- ${name}: ${task.description}`);
  }

  console.log('');
  console.log('Run one with: bun run maintenance -- <task-name>');
};

const main = async (): Promise<void> => {
  const taskName = process.argv[2];

  if (
    !taskName ||
    taskName === '--help' ||
    taskName === 'help' ||
    taskName === 'list'
  ) {
    printTaskList();
    return;
  }

  const task = tasks[taskName];

  if (!task) {
    fail(`Unknown maintenance task: ${taskName}`);
  }

  const exitCode = await runCommandsSequentially(task.commands);
  if (exitCode !== 0) {
    process.exitCode = exitCode;
  }
};

await main().catch((error: unknown) => {
  if (error instanceof CommandLineError) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }

  throw error;
});
