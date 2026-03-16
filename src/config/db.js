const { Pool } = require("pg");

const buildPoolConfig = () => {
  const sslRequired = process.env.DB_SSL === "true" || process.env.NODE_ENV === "production";

  if (process.env.DATABASE_URL) {
    return {
      connectionString: process.env.DATABASE_URL,
      ssl: sslRequired ? { rejectUnauthorized: false } : false,
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
  };
};

const pool = new Pool(buildPoolConfig());

pool.connect()
  .then(() => console.log("✅ PostgreSQL Connected Successfully"))
  .catch(err => console.error("❌ DB Connection Error:", err));

module.exports = pool;
