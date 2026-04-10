const pool = require("../config/db");

let ensureSchemaPromise = null;

const ensureSchema = async (client) => {
  if (!ensureSchemaPromise) {
    ensureSchemaPromise = (async () => {
      const db = client || (await pool.connect());
      const shouldRelease = !client;

      try {
        await db.query("BEGIN");

        await db.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');

        await db.query(`
          CREATE TABLE IF NOT EXISTS coupons (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            code varchar(64) UNIQUE NOT NULL,
            discount_type varchar(32) NOT NULL CHECK (discount_type IN ('percentage', 'fixed')),
            discount_value numeric(12,2) NOT NULL CHECK (discount_value >= 0),
            audience varchar(32) NOT NULL DEFAULT 'all' CHECK (audience IN ('all', 'users_only', 'guests_only')),
            min_order_amount numeric(12,2) NOT NULL DEFAULT 0,
            max_discount_amount numeric(12,2),
            usage_limit integer,
            used_count integer NOT NULL DEFAULT 0,
            per_user_limit integer,
            start_date timestamptz,
            end_date timestamptz,
            is_active boolean NOT NULL DEFAULT true,
            created_at timestamptz NOT NULL DEFAULT NOW(),
            updated_at timestamptz NOT NULL DEFAULT NOW()
          )
        `);

        await db.query("ALTER TABLE coupons ADD COLUMN IF NOT EXISTS audience varchar(32) NOT NULL DEFAULT 'all'");
        await db.query(
          `
            DO $$
            BEGIN
              IF NOT EXISTS (
                SELECT 1
                FROM pg_constraint
                WHERE conname = 'coupons_audience_check'
              ) THEN
                ALTER TABLE coupons
                ADD CONSTRAINT coupons_audience_check
                CHECK (audience IN ('all', 'users_only', 'guests_only'));
              END IF;
            END $$;
          `
        );

        await db.query(`
          CREATE TABLE IF NOT EXISTS coupon_usages (
            id bigserial PRIMARY KEY,
            coupon_id uuid REFERENCES coupons(id) ON DELETE CASCADE,
            order_id uuid REFERENCES orders(id) ON DELETE CASCADE,
            user_id integer,
            guest_token uuid,
            discount_amount numeric(12,2) NOT NULL DEFAULT 0,
            created_at timestamptz NOT NULL DEFAULT NOW(),
            UNIQUE (coupon_id, order_id)
          )
        `);

        await db.query("CREATE INDEX IF NOT EXISTS idx_coupons_code ON coupons(code)");
        await db.query("CREATE INDEX IF NOT EXISTS idx_coupon_usages_coupon ON coupon_usages(coupon_id)");
        await db.query("CREATE INDEX IF NOT EXISTS idx_coupon_usages_user ON coupon_usages(user_id)");
        await db.query("CREATE INDEX IF NOT EXISTS idx_coupon_usages_guest ON coupon_usages(guest_token)");

        await db.query(`
          CREATE TABLE IF NOT EXISTS applied_cart_coupons (
            id bigserial PRIMARY KEY,
            user_id integer,
            guest_token uuid,
            coupon_code varchar(64) NOT NULL,
            created_at timestamptz NOT NULL DEFAULT NOW(),
            updated_at timestamptz NOT NULL DEFAULT NOW()
          )
        `);
        await db.query("CREATE UNIQUE INDEX IF NOT EXISTS ux_applied_cart_coupons_user ON applied_cart_coupons(user_id) WHERE user_id IS NOT NULL");
        await db.query("CREATE UNIQUE INDEX IF NOT EXISTS ux_applied_cart_coupons_guest ON applied_cart_coupons(guest_token) WHERE guest_token IS NOT NULL");
        await db.query("CREATE INDEX IF NOT EXISTS idx_applied_cart_coupons_user ON applied_cart_coupons(user_id)");
        await db.query("CREATE INDEX IF NOT EXISTS idx_applied_cart_coupons_guest ON applied_cart_coupons(guest_token)");

        await db.query("COMMIT");
      } catch (err) {
        await db.query("ROLLBACK");
        throw err;
      } finally {
        if (shouldRelease) {
          db.release();
        }
      }
    })();
  }

  return ensureSchemaPromise;
};

const findByCode = async (client, code) => {
  const result = await client.query(
    `
      SELECT id, code, discount_type, discount_value, audience, min_order_amount, max_discount_amount,
             usage_limit, used_count, per_user_limit, start_date, end_date, is_active
      FROM coupons
      WHERE code = $1
      LIMIT 1
    `,
    [code]
  );

  return result.rows[0] || null;
};

const getUsageStats = async (client, couponId, { userId = null, guestToken = null } = {}) => {
  const stats = {
    total_used: 0,
    user_used: 0,
  };

  const totalResult = await client.query(
    `SELECT COUNT(*)::int AS total_used FROM coupon_usages WHERE coupon_id = $1`,
    [couponId]
  );
  stats.total_used = Number(totalResult.rows[0]?.total_used || 0);

  if (userId || guestToken) {
    const userResult = await client.query(
      `
        SELECT COUNT(*)::int AS user_used
        FROM coupon_usages
        WHERE coupon_id = $1
          AND ( ($2::int IS NOT NULL AND user_id = $2::int)
             OR ($3::uuid IS NOT NULL AND guest_token = $3::uuid) )
      `,
      [couponId, userId, guestToken]
    );
    stats.user_used = Number(userResult.rows[0]?.user_used || 0);
  }

  return stats;
};

const insertUsageIfNeeded = async (client, { couponId, orderId, userId = null, guestToken = null, discountAmount = 0 }) => {
  const result = await client.query(
    `
      INSERT INTO coupon_usages (coupon_id, order_id, user_id, guest_token, discount_amount)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (coupon_id, order_id) DO NOTHING
      RETURNING id
    `,
    [couponId, orderId, userId, guestToken, discountAmount]
  );

  return result.rowCount > 0;
};

const incrementUsedCount = async (client, couponId, usageLimit) => {
  const result = await client.query(
    `
      UPDATE coupons
      SET used_count = used_count + 1, updated_at = NOW()
      WHERE id = $1
        AND (usage_limit IS NULL OR used_count < usage_limit)
      RETURNING used_count
    `,
    [couponId]
  );

  if (!result.rowCount) {
    if (usageLimit !== null && usageLimit !== undefined) {
      const current = await client.query(`SELECT used_count FROM coupons WHERE id = $1`, [couponId]);
      const currentCount = Number(current.rows[0]?.used_count || 0);
      if (currentCount >= usageLimit) {
        const err = new Error("Coupon usage limit reached");
        err.code = "COUPON_LIMIT_REACHED";
        err.status = 400;
        throw err;
      }
    }
    throw new Error("Failed to increment coupon usage count");
  }

  return Number(result.rows[0].used_count);
};

const setAppliedCartCoupon = async (client, { userId = null, guestToken = null, couponCode }) => {
  if (!couponCode) return;
  if (userId) {
    // Delete existing then insert (works with partial unique index)
    await client.query(`DELETE FROM applied_cart_coupons WHERE user_id = $1`, [userId]);
    await client.query(
      `INSERT INTO applied_cart_coupons (user_id, coupon_code, created_at, updated_at) VALUES ($1, $2, NOW(), NOW())`,
      [userId, couponCode]
    );
  } else if (guestToken) {
    await client.query(`DELETE FROM applied_cart_coupons WHERE guest_token = $1`, [guestToken]);
    await client.query(
      `INSERT INTO applied_cart_coupons (guest_token, coupon_code, created_at, updated_at) VALUES ($1, $2, NOW(), NOW())`,
      [guestToken, couponCode]
    );
  }
};

const getAppliedCartCoupon = async (client, { userId = null, guestToken = null }) => {
  let result;
  if (userId) {
    result = await client.query(
      `SELECT coupon_code FROM applied_cart_coupons WHERE user_id = $1 LIMIT 1`,
      [userId]
    );
  } else if (guestToken) {
    result = await client.query(
      `SELECT coupon_code FROM applied_cart_coupons WHERE guest_token = $1 LIMIT 1`,
      [guestToken]
    );
  }
  return result?.rows[0]?.coupon_code || null;
};

const clearAppliedCartCoupon = async (client, { userId = null, guestToken = null }) => {
  if (userId) {
    await client.query(`DELETE FROM applied_cart_coupons WHERE user_id = $1`, [userId]);
  } else if (guestToken) {
    await client.query(`DELETE FROM applied_cart_coupons WHERE guest_token = $1`, [guestToken]);
  }
};

module.exports = {
  ensureSchema,
  findByCode,
  getUsageStats,
  insertUsageIfNeeded,
  incrementUsedCount,
  setAppliedCartCoupon,
  getAppliedCartCoupon,
  clearAppliedCartCoupon,
};
