import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const [lockfilePath, cacheRoot] = process.argv.slice(2);
if (!lockfilePath || !cacheRoot) {
  throw new Error(
    "usage: node prime-bun-fontawesome-cache.mjs LOCKFILE CACHE_ROOT",
  );
}

const removeTrailingCommas = (input) => {
  let escaped = false;
  let inString = false;
  let output = "";
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (inString) {
      output += character;
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }
    if (character === '"') {
      inString = true;
      output += character;
      continue;
    }
    if (character === ",") {
      let nextIndex = index + 1;
      while (/\s/u.test(input[nextIndex] ?? "")) {
        nextIndex += 1;
      }
      if (input[nextIndex] === "}" || input[nextIndex] === "]") {
        continue;
      }
    }
    output += character;
  }
  return output;
};

const lockfile = JSON.parse(
  removeTrailingCommas(await readFile(lockfilePath, "utf8")),
);
if (
  typeof lockfile.packages !== "object" ||
  lockfile.packages === null ||
  Array.isArray(lockfile.packages)
) {
  throw new Error("bun.lock does not contain a packages object");
}

const fontAwesomePackages = Object.entries(lockfile.packages).filter(
  ([packageName, descriptor]) => {
    if (
      !packageName.startsWith("@fortawesome/") ||
      !Array.isArray(descriptor)
    ) {
      return false;
    }
    const packageUrl = descriptor[1];
    return (
      typeof packageUrl === "string" &&
      packageUrl.length > 0 &&
      new URL(packageUrl).hostname === "npm.fontawesome.com"
    );
  },
);
if (fontAwesomePackages.length === 0) {
  throw new Error("bun.lock contains no Font Awesome registry packages");
}

const token = process.env.FONT_AWESOME_TOKEN;
if (!token) {
  throw new Error("FONT_AWESOME_TOKEN is required to prime the Bun cache");
}

const temporaryDirectory = await mkdtemp(
  path.join(tmpdir(), "evorto-fontawesome-cache-"),
);

const readCachedPackage = async (cacheDirectory) => {
  try {
    return JSON.parse(
      await readFile(path.join(cacheDirectory, "package.json"), "utf8"),
    );
  } catch {
    return;
  }
};

const runTar = (arguments_) => {
  const result = spawnSync("tar", arguments_, {
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`tar failed: ${result.stderr.trim()}`);
  }
  return result.stdout;
};

try {
  for (const [packageName, descriptor] of fontAwesomePackages) {
    const [resolvedPackage, packageUrl, , integrity] = descriptor;
    if (
      typeof resolvedPackage !== "string" ||
      typeof packageUrl !== "string" ||
      typeof integrity !== "string" ||
      !integrity.startsWith("sha512-")
    ) {
      throw new Error(`Invalid locked package metadata for ${packageName}`);
    }

    const url = new URL(packageUrl);
    if (url.protocol !== "https:" || url.hostname !== "npm.fontawesome.com") {
      throw new Error(`Unexpected registry URL for ${packageName}`);
    }

    const resolvedPrefix = `${packageName}@`;
    if (!resolvedPackage.startsWith(resolvedPrefix)) {
      throw new Error(`Unexpected locked package identity for ${packageName}`);
    }
    const version = resolvedPackage.slice(resolvedPrefix.length);
    if (!version || version.includes("/") || version.includes("\\")) {
      throw new Error(`Unsafe locked package version for ${packageName}`);
    }

    const cacheDirectory = path.join(
      cacheRoot,
      `${packageName}@${version}@@npm.fontawesome.com@@@1`,
    );
    const cachedPackage = await readCachedPackage(cacheDirectory);
    if (
      cachedPackage?.name === packageName &&
      cachedPackage?.version === version
    ) {
      console.log(`Verified cached ${packageName}@${version}`);
      continue;
    }

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      throw new Error(
        `Font Awesome registry returned ${response.status} for ${packageName}`,
      );
    }
    const archive = Buffer.from(await response.arrayBuffer());
    const actualIntegrity = `sha512-${createHash("sha512")
      .update(archive)
      .digest("base64")}`;
    if (actualIntegrity !== integrity) {
      throw new Error(`Integrity mismatch for ${packageName}@${version}`);
    }

    const archivePath = path.join(
      temporaryDirectory,
      `${packageName.replaceAll("/", "-")}-${version}.tgz`,
    );
    await writeFile(archivePath, archive, { mode: 0o600 });
    const archiveEntries = runTar(["--list", "--gzip", "--file", archivePath])
      .split("\n")
      .filter(Boolean);
    if (
      archiveEntries.length === 0 ||
      archiveEntries.some((entry) => {
        const segments = entry.split("/");
        return (
          (entry !== "package" && !entry.startsWith("package/")) ||
          entry.includes("\\") ||
          segments.includes("..")
        );
      })
    ) {
      throw new Error(`Unsafe package archive layout for ${packageName}`);
    }

    await rm(cacheDirectory, { force: true, recursive: true });
    await mkdir(cacheDirectory, { recursive: true });
    runTar([
      "--extract",
      "--gzip",
      "--file",
      archivePath,
      "--directory",
      cacheDirectory,
      "--strip-components=1",
      "--no-same-owner",
      "--no-same-permissions",
    ]);

    const extractedPackage = await readCachedPackage(cacheDirectory);
    if (
      extractedPackage?.name !== packageName ||
      extractedPackage?.version !== version
    ) {
      throw new Error(`Extracted package identity mismatch for ${packageName}`);
    }
    console.log(`Primed ${packageName}@${version}`);
  }
} finally {
  await rm(temporaryDirectory, { force: true, recursive: true });
}
