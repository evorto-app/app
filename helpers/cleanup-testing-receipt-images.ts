import { cleanupTestingCloudflareImages } from '../src/server/integrations/cloudflare-images';

const DELETE_CONFIRMATION = 'delete-testing-images-only';

const getArgumentValue = (name: string): string | undefined => {
  const prefix = `${name}=`;
  const argument = process.argv.find((value) => value.startsWith(prefix));
  return argument ? argument.slice(prefix.length) : undefined;
};

const hasFlag = (flag: string): boolean => process.argv.includes(flag);

const run = async (): Promise<void> => {
  const dryRun = hasFlag('--dry-run');
  const confirmPhrase = getArgumentValue('--confirm');
  const maxDeletesArgument = getArgumentValue('--max-deletes');
  const maxDeletes =
    maxDeletesArgument === undefined ? undefined : Number(maxDeletesArgument);

  if (!dryRun && confirmPhrase !== DELETE_CONFIRMATION) {
    throw new Error(
      `Refusing to delete images. Pass --confirm=${DELETE_CONFIRMATION}`,
    );
  }

  const result = await cleanupTestingCloudflareImages({
    confirmPhrase,
    dryRun,
    ...(maxDeletes === undefined ? {} : { maxDeletes }),
    source: 'finance-receipt',
  });

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
};

try {
  await run();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
