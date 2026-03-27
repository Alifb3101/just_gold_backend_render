const { Pool } = require("pg");

const buildPoolConfig = () => {
  // For DATABASE_URL (Supabase), SSL is handled via connection string
  // For fallback config, require SSL in production
  const sslRequired = process.env.DB_SSL === "true" || process.env.NODE_ENV === "production" || !!process.env.DATABASE_URL;

  const max = Number.parseInt(process.env.DB_POOL_MAX || process.env.PGPOOLMAX || "12", 10) || 12;
  const min = Number.parseInt(process.env.DB_POOL_MIN || process.env.PGPOOLMIN || "1", 10) || 1;
  const idleTimeoutMillis = Number.parseInt(process.env.DB_POOL_IDLE || "15000", 10) || 15000;
  const connectionTimeoutMillis = Number.parseInt(process.env.DB_POOL_TIMEOUT || "10000", 10) || 10000;
  const maxUses = Number.parseInt(process.env.DB_POOL_MAX_USES || "5000", 10) || 5000;

  if (process.env.DATABASE_URL) {
    return {
      connectionString: process.env.DATABASE_URL,
      // Supabase may have self-signed certs, so reject unauthorized certs = false
      ssl: sslRequired ? { rejectUnauthorized: false } : false,
      // Connection pooling parameters for stability
      max,
      min,
      idleTimeoutMillis, // Close idle connections after configured idle ms
      connectionTimeoutMillis, // Wait max X ms for a connection
      maxUses, // Recycle connections after N uses to avoid bloat
      statement_timeout: 30000, // Kill queries after 30s
    };
  }

  const host = process.env.DB_HOST || process.env.PGHOST || "localhost";
  const port = Number.parseInt(process.env.DB_PORT || process.env.PGPORT || "5432", 10);
  const user = process.env.DB_USER || process.env.PGUSER || "postgres";
  const database = process.env.DB_NAME || process.env.PGDATABASE || "Just_gold";
  const password = process.env.DB_PASSWORD || process.env.PGPASSWORD;

  if (process.env.NODE_ENV === "production" && !password) {
    throw new Error(
      "Missing DATABASE_URL (or DB/PG credentials) environment variable in production"
    );
  }

  return {
    host,
    port: Number.isInteger(port) ? port : 5432,
    user,
    database,
    password,
    ssl: sslRequired ? { rejectUnauthorized: false } : false,
    max,
    min,
    idleTimeoutMillis,
    connectionTimeoutMillis,
    maxUses,
  };
};

const pool = new Pool(buildPoolConfig());

// Handle pool errors to prevent connection leaks
pool.on('error', (err) => {
  console.error('❌ Unexpected error on idle client in pool:', err);
});

// Light-touch telemetry to spot pool exhaustion before it breaks things
const logPoolUsage = () => {
  const total = pool.totalCount;
  const idle = pool.idleCount;
  const waiting = pool.waitingCount;
  if (waiting > 0 || total >= (Number(process.env.DB_POOL_MAX || process.env.PGPOOLMAX || 12) * 0.8)) {
    console.warn('[DB POOL] usage', { total, idle, waiting });
  }
};
setInterval(logPoolUsage, 60000).unref();

pool.on('connect', () => {
  console.log('[DB POOL] New connection established');
});

pool.on('remove', () => {
  console.log('[DB POOL] Connection removed from pool');
});

pool.connect()
  .then(() => console.log("✅ PostgreSQL Connected Successfully"))
  .catch(err => console.error("❌ DB Connection Error:", err));

module.exports = pool;
