const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL must be configured for schema operations");
}

const tlsRequired = process.env.DATABASE_TLS_REQUIRED === "true";
const caCertificate = process.env.DATABASE_TLS_CA_CERTIFICATE;
const tlsServerName = process.env.DATABASE_TLS_SERVER_NAME;

if (tlsRequired && (!caCertificate || !tlsServerName)) {
  throw new Error(
    "DATABASE_TLS_CA_CERTIFICATE and DATABASE_TLS_SERVER_NAME are required for managed schema operations",
  );
}

const managedDatabaseCredentials = () => {
  const parsedUrl = new URL(databaseUrl);
  if (
    parsedUrl.protocol !== "postgresql:" &&
    parsedUrl.protocol !== "postgres:"
  ) {
    throw new Error("DATABASE_URL must use the PostgreSQL protocol");
  }

  const database = decodeURIComponent(parsedUrl.pathname.replace(/^\/+/, ""));
  const user = decodeURIComponent(parsedUrl.username);
  const password = decodeURIComponent(parsedUrl.password);
  if (!parsedUrl.hostname || !database || !user || !password) {
    throw new Error(
      "DATABASE_URL must include host, database, user, and password for managed schema operations",
    );
  }

  return {
    database,
    host: parsedUrl.hostname,
    password,
    port: parsedUrl.port ? Number(parsedUrl.port) : 5432,
    ssl: {
      ca: caCertificate,
      rejectUnauthorized: true,
      servername: tlsServerName,
    },
    user,
  };
};

export default {
  dbCredentials: tlsRequired
    ? managedDatabaseCredentials()
    : { url: databaseUrl },
  dialect: "postgresql",
  schema: "./dist/evorto/ops/schema.mjs",
};
