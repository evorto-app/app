#!/usr/bin/env bun

import { readFileSync } from "node:fs";
import { join } from "node:path";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const dependencies = {
  ...(packageJson.dependencies ?? {}),
  ...(packageJson.devDependencies ?? {}),
};

const tiptapDeps = Object.keys(dependencies).filter((name) =>
  name.startsWith("@tiptap/"),
);

const proDeps = Object.keys(dependencies).filter((name) =>
  name.startsWith("@tiptap-pro/"),
);
if (proDeps.length > 0) {
  console.error(
    `Found disallowed Tiptap Pro dependencies: ${proDeps.join(", ")}`,
  );
  process.exit(1);
}

const lockfilePath = "bun.lock";
let lockfile;
try {
  lockfile = readFileSync(lockfilePath, "utf8");
} catch {
  console.error(
    `Missing ${lockfilePath}. Run "bun install" before checking Tiptap dependencies.`,
  );
  process.exit(1);
}
const forbiddenPatterns = ["@tiptap-pro/", "registry.tiptap.dev"];
for (const pattern of forbiddenPatterns) {
  if (lockfile.includes(pattern)) {
    console.error(`Found forbidden Tiptap platform/pro reference: ${pattern}`);
    process.exit(1);
  }
}

for (const name of tiptapDeps) {
  const path = join("node_modules", ...name.split("/"), "package.json");
  let dependencyPackage;

  try {
    dependencyPackage = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    console.error(
      `Unable to read installed package metadata for ${name} at ${path}`,
    );
    process.exit(1);
  }

  const license = dependencyPackage.license;
  if (license !== "MIT") {
    console.error(
      `Expected MIT license for ${name}, received: ${String(license)}`,
    );
    process.exit(1);
  }
}

console.log(
  "Tiptap dependency license check passed (MIT-only, OSS packages only).",
);
