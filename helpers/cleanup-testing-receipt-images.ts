import { cleanupTestingCloudflareImages } from '../src/server/integrations/cloudflare-images';

const DELETE_CONFIRMATION = 'delete-testing-images-only';

const getArgumentValue = (name: string): null | string => {
  const prefix = `${name}=`;
  const arg = process.argv.find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : null;
};

const hasFlag = (flag: string): boolean => process.argv.includes(flag);

const run = async (): Promise<void> => {
  const dryRun = hasFlag('--dry-run');
  const confirmPhrase = getArgumentValue('--confirm');
  const maxDeletesArgument = getArgumentValue('--max-deletes');
  const maxDeletes =
    maxDeletesArgument === null ? undefined : Number(maxDeletesArgument);

  if (!dryRun && confirmPhrase !== DELETE_CONFIRMATION) {
    throw new Error(
      `Refusing to delete images. Pass --confirm=${DELETE_CONFIRMATION}`,
    );
  }

  const result = await cleanupTestingCloudflareImages({
    confirmPhrase,
    dryRun,
    maxDeletes,
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
      null,
      2,
    ),
  );
};

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
