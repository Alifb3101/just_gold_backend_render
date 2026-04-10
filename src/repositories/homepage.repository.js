const pool = require("../config/db");

const fetchHomepageProducts = async ({ sectionNames, limit }) => {
  const query = {
    text: `
      WITH ranked_products AS (
        SELECT
          s.name AS section_name,
          p.id,
          p.name,
          p.description,
          p.thumbnail,
          COALESCE(v.price, p.base_price) AS price,
          v.discount_price,
          ROW_NUMBER() OVER (
            PARTITION BY s.id
            ORDER BY
              CASE WHEN s.name = 'best_seller' THEN COALESCE(pss.total_sales, 0) END DESC,
              CASE WHEN s.name = 'best_seller' THEN COALESCE(pss.last_30_days_sales, 0) END DESC,
              p.id DESC
          ) AS row_num
        FROM sections s
        JOIN product_sections ps ON ps.section_id = s.id
        JOIN products p ON p.id = ps.product_id
        LEFT JOIN product_sales_stats pss ON pss.product_id = p.id
        LEFT JOIN LATERAL (
          SELECT pv.price, pv.discount_price
          FROM product_variants pv
          WHERE pv.product_id = p.id
          ORDER BY pv.id ASC
          LIMIT 1
        ) v ON TRUE
        WHERE s.is_active = true
          AND p.is_active = true
          AND s.name = ANY($1::text[])
      )
      SELECT
        section_name,
        id,
        name,
        description,
        thumbnail,
        price,
        discount_price
      FROM ranked_products
      WHERE row_num <= $2
      ORDER BY section_name ASC, row_num ASC
    `,
    values: [sectionNames, limit],
  };

  const result = await pool.query(query);
  return result.rows;
};

module.exports = {
  fetchHomepageProducts,
};
