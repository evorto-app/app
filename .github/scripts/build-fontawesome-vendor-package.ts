import { createHash } from 'node:crypto';
import { rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

type FontAwesomePackage = {
  directDependency: boolean;
  integrity: string;
  lockfileKey: string;
  name: string;
  resolved: string;
  tarballFileName?: string;
  tarballSha512?: string;
  version: string;
};

const fontAwesomePackagePattern =
  /^\s+"(?<key>[^"]+)": \["(?<locator>@(?:fortawesome|awesome\.me)\/[^"]+)", "(?<resolved>[^"]*)", .*, "(?<integrity>sha\d+-[^"]+)"\],?$/gm;

const packageName = process.env['VENDOR_PACKAGE_NAME'];
const packageVersion = process.env['VENDOR_PACKAGE_VERSION'];
const sourceRepository = process.env['GITHUB_REPOSITORY'] ?? 'local';
const sourceSha = process.env['GITHUB_SHA'] ?? 'local';
const outputDirectory =
  process.env['FONT_AWESOME_VENDOR_OUT_DIR'] ??
  path.join('dist', 'fontawesome-vendor-package');
const mirroredPackageNames = new Set(
  (
    process.env['FONT_AWESOME_VENDOR_PACKAGE_NAMES'] ??
    '@fortawesome/duotone-regular-svg-icons'
  )
    .split(/[,\s]+/)
    .map((packageName) => packageName.trim())
    .filter(Boolean),
);
const skipDownload = process.env['FONT_AWESOME_VENDOR_SKIP_DOWNLOAD'] === '1';

if (!packageName) {
  throw new Error('VENDOR_PACKAGE_NAME is required.');
}

if (!/^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/.test(packageName)) {
  throw new Error(
    `VENDOR_PACKAGE_NAME must be a lowercase scoped package name. Received: ${packageName}`,
  );
}

if (!packageVersion) {
  throw new Error('VENDOR_PACKAGE_VERSION is required.');
}

if (
  !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(
    packageVersion,
  )
) {
  throw new Error(
    `VENDOR_PACKAGE_VERSION must be a valid semver version. Received: ${packageVersion}`,
  );
}

const packageJson = await Bun.file('package.json').json();
const directDependencies = new Set([
  ...Object.keys(packageJson.dependencies ?? {}),
  ...Object.keys(packageJson.devDependencies ?? {}),
  ...Object.keys(packageJson.optionalDependencies ?? {}),
  ...Object.keys(packageJson.peerDependencies ?? {}),
]);

const lockfile = await Bun.file('bun.lock').text();
const packagesByLocator = new Map<string, FontAwesomePackage>();

for (const match of lockfile.matchAll(fontAwesomePackagePattern)) {
  const groups = match.groups;
  if (!groups) {
    continue;
  }

  const locator = groups['locator'];
  const versionSeparatorIndex = locator.lastIndexOf('@');
  if (versionSeparatorIndex <= 0) {
    throw new Error(`Could not parse Font Awesome package locator: ${locator}`);
  }

  const name = locator.slice(0, versionSeparatorIndex);
  const version = locator.slice(versionSeparatorIndex + 1);
  const uniqueLocator = `${name}@${version}`;

  packagesByLocator.set(uniqueLocator, {
    directDependency: directDependencies.has(name),
    integrity: groups['integrity'],
    lockfileKey: groups['key'],
    name,
    resolved: groups['resolved'],
    version,
  });
}

const fontAwesomePackages = [...packagesByLocator.values()].sort(
  (left, right) =>
    `${left.name}@${left.version}`.localeCompare(
      `${right.name}@${right.version}`,
    ),
);

const mirroredPackages = fontAwesomePackages.filter((fontAwesomePackage) =>
  mirroredPackageNames.has(fontAwesomePackage.name),
);
const missingPackageNames = [...mirroredPackageNames].filter(
  (packageName) =>
    !mirroredPackages.some(
      (fontAwesomePackage) => fontAwesomePackage.name === packageName,
    ),
);

if (missingPackageNames.length > 0) {
  throw new Error(
    `Configured Font Awesome package(s) were not found in bun.lock: ${missingPackageNames.join(', ')}`,
  );
}

if (mirroredPackages.length === 0) {
  throw new Error(
    'No configured Font Awesome packages were found in bun.lock.',
  );
}

await rm(outputDirectory, { force: true, recursive: true });

const tarballsDirectory = path.join(outputDirectory, 'tarballs');
await Bun.$`mkdir -p ${tarballsDirectory}`;

if (!skipDownload) {
  for (const fontAwesomePackage of mirroredPackages) {
    const packageSpecifier = `${fontAwesomePackage.name}@${fontAwesomePackage.version}`;
    const packProcess = Bun.spawnSync({
      cmd: [
        'npm',
        'pack',
        packageSpecifier,
        '--pack-destination',
        tarballsDirectory,
        '--registry',
        'https://npm.fontawesome.com/',
      ],
      env: process.env,
      stderr: 'pipe',
      stdout: 'pipe',
    });

    if (!packProcess.success) {
      throw new Error(
        [
          `Failed to pack ${packageSpecifier}.`,
          packProcess.stderr.toString().trim(),
        ]
          .filter(Boolean)
          .join('\n'),
      );
    }

    const tarballFileName = packProcess.stdout
      .toString()
      .trim()
      .split(/\r?\n/)
      .at(-1);
    if (!tarballFileName) {
      throw new Error(
        `npm pack did not report a tarball for ${packageSpecifier}.`,
      );
    }

    const tarballPath = path.join(tarballsDirectory, tarballFileName);
    const tarballBytes = Buffer.from(await Bun.file(tarballPath).arrayBuffer());
    fontAwesomePackage.tarballFileName = tarballFileName;
    fontAwesomePackage.tarballSha512 = createHash('sha512')
      .update(tarballBytes)
      .digest('base64');
  }
}

const manifest = {
  generatedAt: new Date().toISOString(),
  lockfile: 'bun.lock',
  mirroredPackageNames: [...mirroredPackageNames].sort(),
  packageCount: mirroredPackages.length,
  packages: mirroredPackages,
  sourceRepository,
  sourceSha,
};

await writeFile(
  path.join(outputDirectory, 'package.json'),
  `${JSON.stringify(
    {
      name: packageName,
      version: packageVersion,
      description:
        'Private Evorto Font Awesome Pro vendor bundle generated from the locked package set.',
      files: ['README.md', 'manifest.json', 'tarballs/*.tgz'],
      license: 'UNLICENSED',
      publishConfig: {
        registry: 'https://npm.pkg.github.com',
      },
      repository: {
        type: 'git',
        url: `git+https://github.com/${sourceRepository}.git`,
      },
    },
    null,
    2,
  )}\n`,
);

await writeFile(
  path.join(outputDirectory, 'manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
);

await writeFile(
  path.join(outputDirectory, 'README.md'),
  `# Evorto Font Awesome vendor bundle

This private package is generated by the Font Awesome vendor workflow.

It contains the configured Font Awesome Pro package tarball resolved in
\`bun.lock\` and fetched from \`npm.fontawesome.com\`.

Do not publish this package publicly. Consumers should download it from GitHub
Packages with a token that has access to this repository package.
`,
);

console.log(
  `Prepared ${packageName}@${packageVersion} with ${mirroredPackages.length} Font Awesome package(s).`,
);
for (const fontAwesomePackage of mirroredPackages) {
  console.log(`- ${fontAwesomePackage.name}@${fontAwesomePackage.version}`);
}
