const pool = require("../config/db");

/**
 * GET /api/v1/inventory/admin/products
 * Get all products with their variants inventory (Admin)
 */
exports.getProductsInventory = async (req, res, next) => {
  const client = await pool.connect();

  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;
    const { search, category_id, model_no } = req.query;

    let whereConditions = ["p.is_active = true"];
    let params = [];
    let paramIndex = 1;

    if (search) {
      whereConditions.push(`(p.name ILIKE $${paramIndex} OR p.slug ILIKE $${paramIndex})`);
      params.push(`%${search}%`);
      paramIndex++;
    }

    if (model_no) {
      whereConditions.push(`(p.product_model_no ILIKE $${paramIndex} OR EXISTS (SELECT 1 FROM product_variants pv WHERE pv.product_id = p.id AND pv.variant_model_no ILIKE $${paramIndex}))`);
      params.push(`%${model_no}%`);
      paramIndex++;
    }

    if (category_id) {
      whereConditions.push(`p.category_id = $${paramIndex}`);
      params.push(category_id);
      paramIndex++;
    }

    const whereClause = whereConditions.join(" AND ");

    // Count query
    const countQuery = `
      SELECT COUNT(*) as total
      FROM products p
      WHERE ${whereClause}
    `;
    const countResult = await client.query(countQuery, params);
    const total = parseInt(countResult.rows[0].total, 10);

    // Data query with variants
    const dataQuery = `
      SELECT 
        p.id as product_id,
        p.name as product_name,
        p.base_price,
        p.base_stock,
        p.thumbnail,
        p.category_id,
        c.name as category_name,
        COALESCE(
          json_agg(
            json_build_object(
              'id', pv.id,
              'shade', pv.shade,
              'variant_model_no', pv.variant_model_no,
              'price', pv.price,
              'discount_price', pv.discount_price,
              'stock', pv.stock,
              'is_active', pv.is_active,
              'image', pv.main_image
            ) ORDER BY pv.id
          ) FILTER (WHERE pv.id IS NOT NULL),
          '[]'::json
        ) as variants
      FROM products p
      LEFT JOIN product_variants pv ON pv.product_id = p.id
      LEFT JOIN categories c ON c.id = p.category_id
      WHERE ${whereClause}
      GROUP BY p.id, p.name, p.base_price, p.base_stock, p.thumbnail, p.category_id, c.name
      ORDER BY p.id DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    const dataResult = await client.query(dataQuery, [...params, limit, offset]);

    return res.json({
      success: true,
      data: dataResult.rows.map(row => ({
        product_id: row.product_id,
        product_name: row.product_name,
        base_price: parseFloat(row.base_price),
        base_stock: row.base_stock,
        thumbnail: row.thumbnail,
        category_id: row.category_id,
        category_name: row.category_name,
        variants: row.variants || []
      })),
      pagination: {
        page,
        limit,
        total,
        total_pages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    next(err);
  } finally {
    client.release();
  }
};

/**
 * GET /api/v1/inventory/admin/products/:productId
 * Get single product with full inventory details (Admin)
 */
exports.getProductInventory = async (req, res, next) => {
  const client = await pool.connect();

  try {
    const { productId } = req.params;

    const query = `
      SELECT 
        p.id as product_id,
        p.name as product_name,
        p.description,
        p.base_price,
        p.base_stock,
        p.thumbnail,
        p.afterimage,
        p.category_id,
        c.name as category_name,
        p.is_active,
        p.created_at,
        COALESCE(
          json_agg(
            json_build_object(
              'id', pv.id,
              'shade', pv.shade,
              'variant_model_no', pv.variant_model_no,
              'price', pv.price,
              'stock', pv.stock,
              'is_active', pv.is_active,
              'image', pv.main_image,
              'created_at', pv.created_at
            ) ORDER BY pv.id
          ) FILTER (WHERE pv.id IS NOT NULL),
          '[]'::json
        ) as variants
      FROM products p
      LEFT JOIN product_variants pv ON pv.product_id = p.id
      LEFT JOIN categories c ON c.id = p.category_id
      WHERE p.id = $1
      GROUP BY p.id, p.name, p.description, p.base_price, p.base_stock,
               p.thumbnail, p.afterimage, p.category_id, c.name, p.is_active, p.created_at
    `;

    const result = await client.query(query, [productId]);

    if (!result.rows.length) {
      return res.status(404).json({
        success: false,
        message: "Product not found"
      });
    }

    const row = result.rows[0];

    return res.json({
      success: true,
      data: {
        product_id: row.product_id,
        product_name: row.product_name,
        description: row.description,
        base_price: parseFloat(row.base_price),
        base_stock: row.base_stock,
        thumbnail: row.thumbnail,
        afterimage: row.afterimage,
        category_id: row.category_id,
        category_name: row.category_name,
        is_active: row.is_active,
        created_at: row.created_at,
        variants: row.variants || []
      }
    });
  } catch (err) {
    next(err);
  } finally {
    client.release();
  }
};

/**
 * PUT /api/v1/inventory/admin/variants/:variantId/price
 * Update variant price (Admin)
 */
exports.updateVariantPrice = async (req, res, next) => {
  const client = await pool.connect();

  try {
    const { variantId } = req.params;
    const { price } = req.body;

    // Validation
    if (price === undefined || price === null) {
      return res.status(400).json({
        success: false,
        message: "Price is required"
      });
    }

    const parsedPrice = parseFloat(price);
    if (isNaN(parsedPrice) || parsedPrice < 0) {
      return res.status(400).json({
        success: false,
        message: "Price must be a positive number"
      });
    }

    // Check if variant exists
    const checkQuery = `
      SELECT pv.*, p.name as product_name
      FROM product_variants pv
      JOIN products p ON p.id = pv.product_id
      WHERE pv.id = $1
    `;
    const checkResult = await client.query(checkQuery, [variantId]);

    if (!checkResult.rows.length) {
      return res.status(404).json({
        success: false,
        message: "Variant not found"
      });
    }

    const variant = checkResult.rows[0];
    const oldPrice = parseFloat(variant.price);

    // Update price
    const updateQuery = `
      UPDATE product_variants
      SET price = $1
      WHERE id = $2
      RETURNING *
    `;
    const updateResult = await client.query(updateQuery, [parsedPrice, variantId]);

    return res.json({
      success: true,
      message: "Variant price updated successfully",
      data: {
        variant_id: parseInt(variantId),
        product_id: variant.product_id,
        product_name: variant.product_name,
        shade: variant.shade,
        variant_model_no: variant.variant_model_no,
        old_price: oldPrice,
        new_price: parsedPrice
      }
    });
  } catch (err) {
    next(err);
  } finally {
    client.release();
  }
};

/**
 * PUT /api/v1/inventory/admin/variants/:variantId/discount-price
 * Update variant discount price (Admin)
 */
exports.updateVariantDiscountPrice = async (req, res, next) => {
  const client = await pool.connect();

  try {
    const { variantId } = req.params;
    const { discount_price } = req.body;

    // Validation - allow null/undefined to remove discount
    if (discount_price !== undefined && discount_price !== null) {
      const parsedPrice = parseFloat(discount_price);
      if (isNaN(parsedPrice) || parsedPrice < 0) {
        return res.status(400).json({
          success: false,
          message: "Discount price must be a positive number or null"
        });
      }
    }

    // Check if variant exists
    const checkQuery = `
      SELECT pv.*, p.name as product_name
      FROM product_variants pv
      JOIN products p ON p.id = pv.product_id
      WHERE pv.id = $1
    `;
    const checkResult = await client.query(checkQuery, [variantId]);

    if (!checkResult.rows.length) {
      return res.status(404).json({
        success: false,
        message: "Variant not found"
      });
    }

    const variant = checkResult.rows[0];
    const oldDiscountPrice = variant.discount_price ? parseFloat(variant.discount_price) : null;

    // Update discount price
    const updateQuery = `
      UPDATE product_variants
      SET discount_price = $1
      WHERE id = $2
      RETURNING *
    `;
    const updateResult = await client.query(updateQuery, [discount_price || null, variantId]);

    return res.json({
      success: true,
      message: "Variant discount price updated successfully",
      data: {
        variant_id: parseInt(variantId),
        product_id: variant.product_id,
        product_name: variant.product_name,
        shade: variant.shade,
        variant_model_no: variant.variant_model_no,
        old_discount_price: oldDiscountPrice,
        new_discount_price: discount_price ? parseFloat(discount_price) : null
      }
    });
  } catch (err) {
    next(err);
  } finally {
    client.release();
  }
};

/**
 * PUT /api/v1/inventory/admin/variants/:variantId/stock
 * Update variant stock (Admin)
 */
exports.updateVariantStock = async (req, res, next) => {
  const client = await pool.connect();

  try {
    const { variantId } = req.params;
    const { stock, operation = "set" } = req.body;

    // Validation
    if (stock === undefined || stock === null) {
      return res.status(400).json({
        success: false,
        message: "Stock is required"
      });
    }

    const parsedStock = parseInt(stock, 10);
    if (isNaN(parsedStock) || parsedStock < 0) {
      return res.status(400).json({
        success: false,
        message: "Stock must be a non-negative integer"
      });
    }

    // Validate operation
    const validOperations = ["set", "add", "subtract"];
    if (!validOperations.includes(operation)) {
      return res.status(400).json({
        success: false,
        message: `Operation must be one of: ${validOperations.join(", ")}`
      });
    }

    // Check if variant exists
    const checkQuery = `
      SELECT pv.*, p.name as product_name
      FROM product_variants pv
      JOIN products p ON p.id = pv.product_id
      WHERE pv.id = $1
    `;
    const checkResult = await client.query(checkQuery, [variantId]);

    if (!checkResult.rows.length) {
      return res.status(404).json({
        success: false,
        message: "Variant not found"
      });
    }

    const variant = checkResult.rows[0];
    const oldStock = parseInt(variant.stock, 10) || 0;

    // Calculate new stock based on operation
    let newStock;
    switch (operation) {
      case "add":
        newStock = oldStock + parsedStock;
        break;
      case "subtract":
        newStock = Math.max(0, oldStock - parsedStock);
        break;
      case "set":
      default:
        newStock = parsedStock;
    }

    // Update stock
    const updateQuery = `
      UPDATE product_variants
      SET stock = $1
      WHERE id = $2
      RETURNING *
    `;
    const updateResult = await client.query(updateQuery, [newStock, variantId]);

    return res.json({
      success: true,
      message: "Variant stock updated successfully",
      data: {
        variant_id: parseInt(variantId),
        product_id: variant.product_id,
        product_name: variant.product_name,
        shade: variant.shade,
        variant_model_no: variant.variant_model_no,
        old_stock: oldStock,
        new_stock: newStock,
        operation: operation
      }
    });
  } catch (err) {
    next(err);
  } finally {
    client.release();
  }
};

/**
 * PUT /api/v1/inventory/admin/products/:productId/base-stock
 * Update product base stock (Admin)
 */
exports.updateProductBaseStock = async (req, res, next) => {
  const client = await pool.connect();

  try {
    const { productId } = req.params;
    const { base_stock, operation = "set" } = req.body;

    // Validation
    if (base_stock === undefined || base_stock === null) {
      return res.status(400).json({
        success: false,
        message: "Base stock is required"
      });
    }

    const parsedStock = parseInt(base_stock, 10);
    if (isNaN(parsedStock) || parsedStock < 0) {
      return res.status(400).json({
        success: false,
        message: "Base stock must be a non-negative integer"
      });
    }

    // Validate operation
    const validOperations = ["set", "add", "subtract"];
    if (!validOperations.includes(operation)) {
      return res.status(400).json({
        success: false,
        message: `Operation must be one of: ${validOperations.join(", ")}`
      });
    }

    // Check if product exists
    const checkQuery = `SELECT id, name, base_stock FROM products WHERE id = $1`;
    const checkResult = await client.query(checkQuery, [productId]);

    if (!checkResult.rows.length) {
      return res.status(404).json({
        success: false,
        message: "Product not found"
      });
    }

    const product = checkResult.rows[0];
    const oldStock = parseInt(product.base_stock, 10) || 0;

    // Calculate new stock based on operation
    let newStock;
    switch (operation) {
      case "add":
        newStock = oldStock + parsedStock;
        break;
      case "subtract":
        newStock = Math.max(0, oldStock - parsedStock);
        break;
      case "set":
      default:
        newStock = parsedStock;
    }

    // Update stock
    const updateQuery = `
      UPDATE products
      SET base_stock = $1
      WHERE id = $2
      RETURNING id, name, base_stock
    `;
    const updateResult = await client.query(updateQuery, [newStock, productId]);

    return res.json({
      success: true,
      message: "Product base stock updated successfully",
      data: {
        product_id: parseInt(productId),
        product_name: product.name,
        old_stock: oldStock,
        new_stock: newStock,
        operation: operation
      }
    });
  } catch (err) {
    next(err);
  } finally {
    client.release();
  }
};

/**
 * PUT /api/v1/inventory/admin/products/:productId/base-price
 * Update product base price (Admin)
 */
exports.updateProductBasePrice = async (req, res, next) => {
  const client = await pool.connect();

  try {
    const { productId } = req.params;
    const { base_price } = req.body;

    // Validation
    if (base_price === undefined || base_price === null) {
      return res.status(400).json({
        success: false,
        message: "Base price is required"
      });
    }

    const parsedPrice = parseFloat(base_price);
    if (isNaN(parsedPrice) || parsedPrice < 0) {
      return res.status(400).json({
        success: false,
        message: "Base price must be a positive number"
      });
    }

    // Check if product exists
    const checkQuery = `SELECT id, name, base_price FROM products WHERE id = $1`;
    const checkResult = await client.query(checkQuery, [productId]);

    if (!checkResult.rows.length) {
      return res.status(404).json({
        success: false,
        message: "Product not found"
      });
    }

    const product = checkResult.rows[0];
    const oldPrice = parseFloat(product.base_price);

    // Update price
    const updateQuery = `
      UPDATE products
      SET base_price = $1
      WHERE id = $2
      RETURNING id, name, base_price
    `;
    const updateResult = await client.query(updateQuery, [parsedPrice, productId]);

    return res.json({
      success: true,
      message: "Product base price updated successfully",
      data: {
        product_id: parseInt(productId),
        product_name: product.name,
        old_price: oldPrice,
        new_price: parsedPrice
      }
    });
  } catch (err) {
    next(err);
  } finally {
    client.release();
  }
};

/**
 * PUT /api/v1/inventory/admin/bulk/update
 * Bulk update inventory (Admin)
 */
exports.bulkUpdateInventory = async (req, res, next) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const { updates } = req.body;

    if (!Array.isArray(updates) || updates.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Updates array is required"
      });
    }

    const results = [];
    const errors = [];

    for (const update of updates) {
      const { type, id, price, stock, operation = "set" } = update;

      try {
        if (type === "variant") {
          // Update variant
          if (price !== undefined) {
            const priceQuery = `
              UPDATE product_variants
              SET price = $1
              WHERE id = $2
              RETURNING id, price
            `;
            await client.query(priceQuery, [parseFloat(price), id]);
          }

          if (stock !== undefined) {
            let newStock = parseInt(stock, 10);
            if (operation === "add") {
              const currentQuery = `SELECT stock FROM product_variants WHERE id = $1`;
              const currentResult = await client.query(currentQuery, [id]);
              newStock = (parseInt(currentResult.rows[0]?.stock, 10) || 0) + newStock;
            } else if (operation === "subtract") {
              const currentQuery = `SELECT stock FROM product_variants WHERE id = $1`;
              const currentResult = await client.query(currentQuery, [id]);
              newStock = Math.max(0, (parseInt(currentResult.rows[0]?.stock, 10) || 0) - newStock);
            }

            const stockQuery = `
              UPDATE product_variants
              SET stock = $1
              WHERE id = $2
              RETURNING id, stock
            `;
            await client.query(stockQuery, [newStock, id]);
          }

          results.push({ type, id, status: "success" });
        } else if (type === "product") {
          // Update product base
          if (price !== undefined) {
            const priceQuery = `
              UPDATE products
              SET base_price = $1
              WHERE id = $2
              RETURNING id, base_price
            `;
            await client.query(priceQuery, [parseFloat(price), id]);
          }

          if (stock !== undefined) {
            let newStock = parseInt(stock, 10);
            if (operation === "add") {
              const currentQuery = `SELECT base_stock FROM products WHERE id = $1`;
              const currentResult = await client.query(currentQuery, [id]);
              newStock = (parseInt(currentResult.rows[0]?.base_stock, 10) || 0) + newStock;
            } else if (operation === "subtract") {
              const currentQuery = `SELECT base_stock FROM products WHERE id = $1`;
              const currentResult = await client.query(currentQuery, [id]);
              newStock = Math.max(0, (parseInt(currentResult.rows[0]?.base_stock, 10) || 0) - newStock);
            }

            const stockQuery = `
              UPDATE products
              SET base_stock = $1
              WHERE id = $2
              RETURNING id, base_stock
            `;
            await client.query(stockQuery, [newStock, id]);
          }

          results.push({ type, id, status: "success" });
        }
      } catch (err) {
        errors.push({ type, id, error: err.message });
      }
    }

    await client.query("COMMIT");

    return res.json({
      success: true,
      message: "Bulk update completed",
      data: {
        processed: results.length,
        errors: errors.length,
        results,
        errors: errors.length > 0 ? errors : undefined
      }
    });
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally {
    client.release();
  }
};

/**
 * GET /api/v1/inventory/admin/low-stock
 * Get low stock products and variants (Admin)
 */
exports.getLowStockItems = async (req, res, next) => {
  const client = await pool.connect();

  try {
    const threshold = parseInt(req.query.threshold, 10) || 10;

    // Get products with low base stock
    const productsQuery = `
      SELECT 
        p.id as product_id,
        p.name as product_name,
        p.base_stock,
        p.thumbnail,
        'product' as item_type,
        NULL as variant_id,
        NULL as shade
      FROM products p
      WHERE p.base_stock <= $1 AND p.base_stock > 0 AND p.is_active = true
    `;

    // Get variants with low stock
    const variantsQuery = `
      SELECT 
        p.id as product_id,
        p.name as product_name,
        pv.stock as base_stock,
        p.thumbnail,
        'variant' as item_type,
        pv.id as variant_id,
        pv.shade
      FROM product_variants pv
      JOIN products p ON p.id = pv.product_id
      WHERE pv.stock <= $1 AND pv.stock > 0 AND pv.is_active = true AND p.is_active = true
    `;

    const [productsResult, variantsResult] = await Promise.all([
      client.query(productsQuery, [threshold]),
      client.query(variantsQuery, [threshold])
    ]);

    const allItems = [
      ...productsResult.rows,
      ...variantsResult.rows
    ].sort((a, b) => a.base_stock - b.base_stock);

    return res.json({
      success: true,
      data: allItems.map(row => ({
        product_id: row.product_id,
        product_name: row.product_name,
        thumbnail: row.thumbnail,
        item_type: row.item_type,
        variant_id: row.variant_id,
        shade: row.shade,
        current_stock: row.base_stock,
        threshold: threshold
      })),
      summary: {
        total_low_stock: allItems.length,
        products_count: productsResult.rows.length,
        variants_count: variantsResult.rows.length,
        threshold: threshold
      }
    });
  } catch (err) {
    next(err);
  } finally {
    client.release();
  }
};
