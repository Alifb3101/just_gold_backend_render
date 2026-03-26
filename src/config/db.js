const { Pool } = require("pg");

const buildPoolConfig = () => {
  // For DATABASE_URL (Supabase), SSL is handled via connection string
  // For fallback config, require SSL in production
  const sslRequired = process.env.DB_SSL === "true" || process.env.NODE_ENV === "production" || !!process.env.DATABASE_URL;

  if (process.env.DATABASE_URL) {
    return {
      connectionString: process.env.DATABASE_URL,
      // Supabase may have self-signed certs, so reject unauthorized certs = false
      ssl: sslRequired ? { rejectUnauthorized: false } : false,
      // Connection pooling parameters for stability
      max: 20,
      min: 2,
      idleTimeoutMillis: 15000, // Close idle connections after 15s
      connectionTimeoutMillis: 10000, // Wait max 10s for a connection
      maxUses: 7500, // Recycle connections after 7500 uses
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
    max: 20,
    min: 2,
    idleTimeoutMillis: 15000,
    connectionTimeoutMillis: 10000,
  };
};

const pool = new Pool(buildPoolConfig());

// Handle pool errors to prevent connection leaks
pool.on('error', (err) => {
  console.error('❌ Unexpected error on idle client in pool:', err);
});

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
