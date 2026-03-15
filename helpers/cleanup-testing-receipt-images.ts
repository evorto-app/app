import { BunRuntime } from '@effect/platform-bun';
import { Effect } from 'effect';

import { makeRuntimeConfigProvider } from '../src/server/config/provider';
import { cleanupTestingCloudflareImages } from '../src/server/integrations/cloudflare-images';

const DELETE_CONFIRMATION = 'delete-testing-images-only';

const getArgumentValue = (name: string) => {
  const prefix = `${name}=`;
  const argument = process.argv.find((value) => value.startsWith(prefix));
  return argument ? argument.slice(prefix.length) : undefined;
};

const hasFlag = (flag: string) => process.argv.includes(flag);

const main = Effect.gen(function* () {
  const dryRun = hasFlag('--dry-run');
  const confirmPhrase = getArgumentValue('--confirm');
  const maxDeletesArgument = getArgumentValue('--max-deletes');
  const maxDeletes =
    maxDeletesArgument === undefined
      ? undefined
      : Number.parseInt(maxDeletesArgument, 10);

  if (
    maxDeletesArgument !== undefined &&
    (maxDeletes === undefined ||
      !Number.isInteger(maxDeletes) ||
      maxDeletes < 0)
  ) {
    throw new Error(
      `Invalid --max-deletes value "${maxDeletesArgument}". Expected a non-negative integer.`,
    );
  }

  if (!dryRun && confirmPhrase !== DELETE_CONFIRMATION) {
    throw new Error(
      `Refusing to delete images. Pass --confirm=${DELETE_CONFIRMATION}`,
    );
  }

  const runtimeConfigProvider = yield* makeRuntimeConfigProvider();
  const result = yield* (
    cleanupTestingCloudflareImages({
      confirmPhrase,
      dryRun,
      ...(maxDeletes === undefined ? {} : { maxDeletes }),
      source: 'finance-receipt',
    }).pipe(
      Effect.withConfigProvider(runtimeConfigProvider),
    )
  );

  yield* Effect.sync(() => {
    console.info(
      JSON.stringify(
        {
          deletedCount: result.deletedImageIds.length,
          deletedImageIds: result.deletedImageIds,
          inspectedCount: result.inspectedCount,
          matchedCount: result.matchedCount,
        },
        undefined,
        2,
      ),
    );
  });
});

BunRuntime.runMain(main);
