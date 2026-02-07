import crypto from "node:crypto";
import path from "node:path";

const DEFAULT_APP_HOST_PORT = 4200;
const DEFAULT_NEON_LOCAL_HOST_PORT = 55432;

const databaseName = process.env["NEON_DATABASE_NAME"]?.trim() || "appdb";

const deriveSeed = () => {
  const runId = process.env["GITHUB_RUN_ID"]?.trim();
  const runAttempt = process.env["GITHUB_RUN_ATTEMPT"]?.trim();
  if (runId) {
    return `${runId}:${runAttempt || "1"}`;
  }

  return process.cwd();
};

const seed = deriveSeed();
const digest = crypto.createHash("sha256").update(seed).digest();
const seedNumber = digest.readUInt32BE(0);

const parsePort = (value) => {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isInteger(parsed) || parsed < 1024 || parsed > 65_535) {
    return undefined;
  }
  return parsed;
};

const resolvePort = (name, fallback) =>
  parsePort(process.env[name]) ?? fallback;

const appHostPort = resolvePort("APP_HOST_PORT", DEFAULT_APP_HOST_PORT);
const neonLocalHostPort = resolvePort(
  "NEON_LOCAL_HOST_PORT",
  DEFAULT_NEON_LOCAL_HOST_PORT,
);

const sanitizeProjectName = (value) =>
  value
    .toLowerCase()
    .replaceAll(/[^a-z0-9_-]+/g, "-")
    .replaceAll(/-+/g, "-")
    .replaceAll(/^-|-$/g, "")
    .slice(0, 40);

const defaultProjectName = () => {
  const basename = path.basename(process.cwd());
  const safeBasename = sanitizeProjectName(basename || "evorto");
  const suffix = digest.toString("hex").slice(0, 8);
  return `${safeBasename}-${suffix}`;
};

const composeProjectName =
  process.env["COMPOSE_PROJECT_NAME"]?.trim() || defaultProjectName();
const baseUrl = `http://localhost:${appHostPort}`;
const databaseUrl = `postgresql://neon:npg@localhost:${neonLocalHostPort}/${databaseName}?sslmode=require`;

const shellQuote = (value) => `'${String(value).replaceAll("'", `'\"'\"'`)}'`;

const environment = {
  APP_HOST_PORT: appHostPort,
  BASE_URL: baseUrl,
  COMPOSE_PROJECT_NAME: composeProjectName,
  DATABASE_URL: databaseUrl,
  NEON_DATABASE_NAME: databaseName,
  NEON_LOCAL_HOST_PORT: neonLocalHostPort,
  NEON_LOCAL_PROXY: "true",
  PLAYWRIGHT_TEST_BASE_URL: baseUrl,
};

for (const [key, value] of Object.entries(environment)) {
  process.stdout.write(`export ${key}=${shellQuote(value)}\n`);
}
