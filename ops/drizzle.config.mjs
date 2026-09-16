import { isIP } from "node:net";
import { checkServerIdentity } from "node:tls";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL must be configured for schema operations");
}

const tlsRequiredValue = process.env.DATABASE_TLS_REQUIRED?.trim();
if (tlsRequiredValue !== "true" && tlsRequiredValue !== "false") {
  throw new Error(
    "DATABASE_TLS_REQUIRED must be explicitly configured as true or false",
  );
}
const tlsRequired = tlsRequiredValue === "true";
const caCertificate = process.env.DATABASE_TLS_CA_CERTIFICATE;
const tlsServerName = process.env.DATABASE_TLS_SERVER_NAME;

if (tlsRequired && !caCertificate?.trim()) {
  throw new Error(
    "DATABASE_TLS_CA_CERTIFICATE is required for managed schema operations",
  );
}

if (caCertificate !== undefined && caCertificate.trim().length === 0) {
  throw new Error("DATABASE_TLS_CA_CERTIFICATE must not be blank");
}

const normalizeDatabaseHostname = (hostname) => {
  if (!hostname.includes("[") && !hostname.includes("]")) return hostname;
  const unbracketed = hostname.slice(1, -1);
  if (
    hostname.startsWith("[") &&
    hostname.endsWith("]") &&
    isIP(unbracketed) === 6
  ) {
    return unbracketed;
  }
  throw new Error(
    "Database TLS identity brackets must contain one valid IPv6 address",
  );
};

const managedDatabaseCredentials = () => {
  const parsedUrl = new URL(databaseUrl);
  if (
    parsedUrl.protocol !== "postgresql:" &&
    parsedUrl.protocol !== "postgres:"
  ) {
    throw new Error("DATABASE_URL must use the PostgreSQL protocol");
  }

  const queryKeys = [...parsedUrl.searchParams.keys()];
  if (
    queryKeys.some(
      (name) => name.startsWith("ssl") || name === "uselibpqcompat",
    )
  ) {
    throw new Error(
      "DATABASE_URL must not include SSL options when DATABASE_TLS_CA_CERTIFICATE is configured",
    );
  }
  const supportedQueryKeys = new Set(["host", "port", "user", "password"]);
  if (queryKeys.some((name) => !supportedQueryKeys.has(name))) {
    throw new Error(
      "DATABASE_URL only supports host, port, user, and password query options for managed schema operations",
    );
  }

  const database = decodeURI(parsedUrl.pathname.slice(1));
  const host = normalizeDatabaseHostname(
    parsedUrl.searchParams.getAll("host").at(-1) ||
      decodeURIComponent(parsedUrl.hostname),
  );
  const user =
    parsedUrl.searchParams.getAll("user").at(-1) ||
    decodeURIComponent(parsedUrl.username);
  const password =
    parsedUrl.searchParams.getAll("password").at(-1) ||
    decodeURIComponent(parsedUrl.password);
  const configuredPort =
    parsedUrl.searchParams.getAll("port").at(-1) || parsedUrl.port || "5432";
  const port = Number(configuredPort);
  if (
    !/^\d+$/u.test(configuredPort) ||
    !Number.isSafeInteger(port) ||
    port < 1 ||
    port > 65535
  ) {
    throw new Error(
      "DATABASE_URL port must be an integer between 1 and 65535 for managed schema operations",
    );
  }
  if (!host || !database || !user || !password) {
    throw new Error(
      "DATABASE_URL must include host, database, user, and password for managed schema operations",
    );
  }
  const serverIdentity = normalizeDatabaseHostname(tlsServerName || host);

  return {
    database,
    host,
    password,
    port,
    ssl: {
      ca: caCertificate,
      checkServerIdentity: (_hostname, certificate) =>
        checkServerIdentity(serverIdentity, certificate),
      rejectUnauthorized: true,
      ...(tlsServerName && isIP(serverIdentity) === 0
        ? { servername: serverIdentity }
        : {}),
    },
    user,
  };
};

export default {
  dbCredentials:
    caCertificate !== undefined
      ? managedDatabaseCredentials()
      : { url: databaseUrl },
  dialect: "postgresql",
  schema: "./dist/evorto/ops/schema.mjs",
};
