const pool = require("../config/db");
const { deleteMultipleFromCloudinary } = require("../config/cloudinary");
const { DeleteObjectCommand } = require("@aws-sdk/client-s3");
const s3 = require("../config/s3");
const { getMediaUrl, resolveMediaUrl } = require("../services/media.service");
const { buildImageKitVariants } = require("../utils/imagekitVariants");
const {
  buildProductsQuery,
  buildCacheKey,
  normalizeFilters,
} = require("../services/product.service");
const { logSearchQuery } = require("../services/search.service");
const { getRedisClient } = require("../config/redis");

const COLOR_PANEL_TYPES = ["hex", "gradient", "image"];
const CATEGORY_SECTION_RULES = {
  3: ["best_seller"],
  2: ["new_arrivals"],
};

const TAG_TYPES = ["country", "badge"];
const TAG_CODE_REGEX = /^[A-Z0-9_-]{1,24}$/;
const MAX_TAGS = 20;

let ensuredProductTagsColumn = false;

const ensureProductTagsColumn = async (client) => {
  if (ensuredProductTagsColumn) return;
  const runner = client || pool;
  await runner.query(
    `ALTER TABLE products ADD COLUMN IF NOT EXISTS tags JSONB DEFAULT '[]'::jsonb`
  );
  await runner.query(
    `CREATE INDEX IF NOT EXISTS idx_products_tags ON products USING GIN (tags)`
  );
  await runner.query(`UPDATE products SET tags = '[]'::jsonb WHERE tags IS NULL`);
  await runner.query(
    `DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'products' AND column_name = 'tag'
      ) THEN
        UPDATE products
        SET tags = jsonb_build_array(jsonb_build_object('type', 'badge', 'code', UPPER(TRIM(tag))))
        WHERE (tags IS NULL OR tags = '[]'::jsonb)
          AND tag IS NOT NULL
          AND TRIM(tag) <> ''
          AND UPPER(TRIM(tag)) ~ '^[A-Z0-9_-]{1,24}$';
      END IF;
    END
    $$;`
  );
  ensuredProductTagsColumn = true;
};

const normalizeTagsInput = (rawTags, legacyTag, { required = false } = {}) => {
  if (rawTags === undefined || rawTags === null || rawTags === "") {
    if (legacyTag !== undefined && legacyTag !== null && `${legacyTag}`.trim() !== "") {
      const legacyCode = `${legacyTag}`.trim().toUpperCase();
      if (!TAG_CODE_REGEX.test(legacyCode)) {
        return {
          error: "tag must be alphanumeric, dash, or underscore (max 24 chars)",
        };
      }
      return { shouldUpdate: true, tags: [{ type: "badge", code: legacyCode }] };
    }

    return required ? { shouldUpdate: true, tags: [] } : { shouldUpdate: false, tags: null };
  }

  let parsed = rawTags;
  if (typeof rawTags === "string") {
    try {
      parsed = JSON.parse(rawTags);
    } catch (_) {
      return { error: "tags must be valid JSON (array of objects)" };
    }
  }

  if (!Array.isArray(parsed)) {
    return { error: "tags must be an array of tag objects" };
  }

  if (parsed.length > MAX_TAGS) {
    return { error: `tags cannot contain more than ${MAX_TAGS} items` };
  }

  const normalized = [];

  for (let i = 0; i < parsed.length; i += 1) {
    const tag = parsed[i];

    if (!tag || typeof tag !== "object" || Array.isArray(tag)) {
      return { error: `tags[${i}] must be an object with type and code` };
    }

    const type = String(tag.type || "").trim().toLowerCase();
    const codeRaw = String(tag.code || "").trim();

    if (!TAG_TYPES.includes(type)) {
      return { error: `tags[${i}].type must be one of: ${TAG_TYPES.join(", ")}` };
    }

    const code = codeRaw.toUpperCase();
    if (!code || !TAG_CODE_REGEX.test(code)) {
      return {
        error: `tags[${i}].code must be alphanumeric/underscore/dash (1-24 chars)`
      };
    }

    normalized.push({ type, code });
  }

  return { shouldUpdate: true, tags: normalized };
};

const pickCategoryId = (body = {}) => {
  const candidates = [
    body.subcategory_id,
    body.subcategoryId,
    body.category_id,
    body.categoryId,
  ];

  for (const value of candidates) {
    if (value === undefined || value === null) continue;
    if (typeof value === "string" && value.trim() === "") continue;

    const parsed = Number.parseInt(value, 10);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }

  return null;
};

const AUTO_SECTION_NAMES = [...new Set(Object.values(CATEGORY_SECTION_RULES).flat())];

const syncAutoSectionsByCategory = async ({ client, productId, categoryId }) => {
  if (!productId || !AUTO_SECTION_NAMES.length) return;

  const normalizedCategoryId = Number.parseInt(categoryId, 10);
  const targetSectionNames = Number.isNaN(normalizedCategoryId)
    ? []
    : CATEGORY_SECTION_RULES[normalizedCategoryId] || [];

  await client.query(
    `
      DELETE FROM product_sections
      WHERE product_id = $1
        AND section_id IN (
          SELECT id
          FROM sections
          WHERE name = ANY($2::text[])
        )
    `,
    [productId, AUTO_SECTION_NAMES]
  );

  if (!targetSectionNames.length) return;

  await client.query(
    `
      INSERT INTO product_sections (product_id, section_id)
      SELECT $1, s.id
      FROM sections s
      WHERE s.name = ANY($2::text[])
      ON CONFLICT (product_id, section_id) DO NOTHING
    `,
    [productId, targetSectionNames]
  );
};

// Extracts the Cloudinary/R2 storage key from a full URL (removes version + extension)
const extractMediaKeyFromUrl = (url) => {
  if (!url || typeof url !== "string") return null;

  try {
    const noQuery = url.split("?")[0];
    const marker = "/upload/";
    const idx = noQuery.indexOf(marker);
    if (idx === -1) return null;

    const after = noQuery.slice(idx + marker.length);
    const parts = after.split("/");
    const withoutVersion = parts[0]?.match(/^v\d+$/) ? parts.slice(1) : parts;
    const path = withoutVersion.join("/");
    return path.replace(/\.[^/.]+$/, "") || null;
  } catch (_) {
    return null;
  }
};

// Derives both the served URL and storage key for a newly uploaded file
const deriveMediaParams = (file, fallbackUrl = null) => {
  if (!file) {
    return {
      url: fallbackUrl || null,
      key: extractMediaKeyFromUrl(fallbackUrl),
      provider: fallbackUrl ? 'cloudinary' : null,
    };
  }

  // Handle ImageKit CDN via S3-backed uploads (key-first storage)
  if (file.imagekitKey) {
    const endpoint = (process.env.IMAGEKIT_URL_ENDPOINT || "").replace(/\/$/, "");
    const key = file.imagekitKey;
    const url = endpoint ? `${endpoint}/${key}` : null;
    console.log("[DERIVE MEDIA PARAMS] ImageKit (S3) upload:", { url, key });
    return { url, key, provider: 'imagekit' };
  }

  // Handle legacy ImageKit uploads (direct SDK/REST)
  if (file.imagekit) {
    const url = file.imagekit.url;
    const key = file.imagekit.fileId || file.imagekit.name || extractMediaKeyFromUrl(url);
    console.log("[DERIVE MEDIA PARAMS] ImageKit upload:", { url, key });
    return { url, key, provider: 'imagekit' };
  }

  // Handle Cloudinary uploads
  if (file.cloudinary) {
    const url = file.cloudinary.secure_url;
    const key = file.cloudinary.public_id;
    console.log("[DERIVE MEDIA PARAMS] Cloudinary upload:", { url, key });
    return { url, key, provider: 'cloudinary' };
  }

  // Fallback: just use file.path (for backward compatibility)
  const url = file.path || null;
  const key = extractMediaKeyFromUrl(url);
  const provider = url ? 'imagekit' : null;
  
  console.log("[DERIVE MEDIA PARAMS] Fallback:", { url, key, provider });
  return { url, key, provider };
};

const isValidHexColor = (value) => {
  if (typeof value !== "string") return false;
  return /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{4}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/.test(
    value.trim()
  );
};

const isValidHttpUrl = (value) => {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch (_) {
    return false;
  }
};

const isValidGradient = (value) => {
  if (typeof value !== "string") return false;
  return /(linear|radial|conic|repeating-linear|repeating-radial)-gradient\s*\(.+\)/i.test(
    value.trim()
  );
};

const normalizeProviderName = (value) => {
  if (!value) return null;
  const lower = String(value).trim().toLowerCase();
  if (lower === "cloudinary" || lower === "imagekit") return lower;
  return null;
};

// Batch delete objects from S3 (ImageKit-backed uploads)
const deleteFromS3 = async (keys = []) => {
  const filtered = (keys || []).filter(Boolean);
  if (!filtered.length) return;

  const bucket = process.env.S3_BUCKET;
  if (!bucket) {
    console.warn("[S3 DELETE] Missing S3_BUCKET env; skip delete", { count: filtered.length });
    return;
  }

  const deletions = filtered.map((Key) =>
    s3.send(new DeleteObjectCommand({ Bucket: bucket, Key })).catch((err) => {
      console.error("[S3 DELETE] Failed", { Key, message: err.message });
    })
  );

  await Promise.all(deletions);
};

const validateColorPanel = (rawType, rawValue, { requireValue, uploadedUrl }) => {
  // Debug visibility for incoming values
  console.log('[COLOR PANEL VALIDATE]', {
    rawType,
    rawValue,
    requireValue,
    hasUpload: !!uploadedUrl,
  });

  const hasUploadedUrl = !!uploadedUrl;
  const hasValue = rawValue !== undefined && rawValue !== null;
  const normalizedType = rawType
    ? rawType.toString().trim().toLowerCase()
    : hasUploadedUrl
    ? "image"
    : null;
  const hasType = normalizedType !== null;

  const needsValue = requireValue || hasUploadedUrl || hasValue || hasType;

  // Nothing provided and not required → no update
  if (!needsValue) {
    return { shouldUpdate: false, colorPanelType: null, colorPanelValue: null };
  }

  if (!hasType) {
    return {
      error: "color_panel_type is required when updating color panel",
      debug: { rawType, rawValue, uploadedUrl, requireValue }
    };
  }

  if (hasUploadedUrl && normalizedType !== "image") {
    return {
      error: "color_panel_type must be image when uploading color panel image",
      debug: { rawType, rawValue, uploadedUrl }
    };
  }

  const colorPanelType = normalizedType || "hex";
  const colorPanelValue = (rawValue || "").toString().trim();
  const finalValue = uploadedUrl || colorPanelValue;

  const isPendingUpload =
    typeof finalValue === "string" && finalValue.startsWith("__PENDING_UPLOAD__");

  if (colorPanelType === "image" && isPendingUpload) {
    // Frontend may send a placeholder while upload is pending; skip validation/store nothing
    return {
      shouldUpdate: false,
      colorPanelType: null,
      colorPanelValue: null,
      debug: { pendingUpload: true },
    };
  }

  if (hasUploadedUrl && colorPanelType !== "image") {
    return {
      error: "color_panel_type must be image when uploading color panel image",
      debug: { rawType, rawValue, uploadedUrl }
    };
  }

  if (!COLOR_PANEL_TYPES.includes(colorPanelType)) {
    return {
      error: "color_panel_type must be one of: hex, gradient, image",
      debug: { colorPanelType, rawType }
    };
  }

  if (!finalValue) {
    return {
      error: "color_panel_value is required for color panel configuration",
      debug: { rawType, rawValue, uploadedUrl, requireValue }
    };
  }

  if (
    (colorPanelType === "hex" && !isValidHexColor(finalValue)) ||
    (colorPanelType === "image" && !hasUploadedUrl && !isValidHttpUrl(finalValue)) ||
    (colorPanelType === "gradient" && !isValidGradient(finalValue))
  ) {
    return {
      error: `color_panel_value is not valid for type ${colorPanelType}`,
    };
  }

  return { shouldUpdate: true, colorPanelType, colorPanelValue: finalValue };
};

/* =========================================================
   GET PRODUCTS (WITH PAGINATION)
========================================================= */
exports.getProducts = async (req, res, next) => {
  try {
    await ensureProductTagsColumn();

    const rawTagFilter = req.query.tagCode || req.query.tag;

    const filters = normalizeFilters({
      categoryId: req.query.category,
      minPrice: req.query.minPrice,
      maxPrice: req.query.maxPrice,
      color: req.query.color,
      size: req.query.size,
      tagCode: rawTagFilter,
      sort: req.query.sort,
      cursor: req.query.cursor,
      page: req.query.page,
      limit: req.query.limit,
      search: req.query.search,
    });

    if (rawTagFilter && !filters.tagCode) {
      return res.status(400).json({ message: "Invalid tag code filter" });
    }

    if (filters.search) {
      logSearchQuery(filters.search);
    }
    const cacheKey = buildCacheKey(filters);
    const redis = await getRedisClient();

    if (redis) {
      const cached = await redis.get(cacheKey);
      if (cached) {
        return res.json(JSON.parse(cached));
      }
    }

    const { text, values, limit, mode, page } = buildProductsQuery(filters);

    // Search-specific debug logging to diagnose search issues without affecting other traffic
    if (filters.search) {
      console.log("[SEARCH DEBUG] filters:", filters);
      console.log("[SEARCH DEBUG] sql:\n", text);
      console.log("[SEARCH DEBUG] params:", values);
    }


    const result = await pool.query({ text, values });

    const hasMore = result.rows.length > limit;
    const trimmed = hasMore ? result.rows.slice(0, limit) : result.rows;
    const nextCursor = hasMore ? trimmed[trimmed.length - 1].id : null;
    const products = trimmed.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      description: row.description,
      price: Number(row.effective_price),
      base_price: Number(row.base_price),
      base_stock: row.base_stock,
      category_id: row.category_id,
      created_at: row.created_at,
      tags: row.tags || [],
      thumbnail: resolveMediaUrl(row.thumbnail, row.thumbnail_key, row.media_provider, 'thumbnail'),
      afterimage: resolveMediaUrl(row.afterimage, row.afterimage_key, row.media_provider, 'product'),
    }));

    const payload =
      mode === "page"
        ? {
            page,
            limit,
            count: products.length,
            products,
          }
        : {
            products,
            nextCursor,
            hasMore,
          };

    if (redis) {
      await redis.set(cacheKey, JSON.stringify(payload), { EX: 60 });
    }

    res.json(payload);
  } catch (err) {
    next(err);
  }
};



/* =========================================================
   GET SINGLE PRODUCT (ID + SLUG VALIDATION)
========================================================= */
exports.getProductDetail = async (req, res, next) => {
  try {
    await ensureProductTagsColumn();

    const productId = parseInt(req.params.id, 10);

    if (Number.isNaN(productId)) {
      return res.status(400).json({ message: "Invalid product id" });
    }

    const requestedSlug = req.params.slug;

    const productResult = await pool.query(
      `
      SELECT 
        id,
        name,
        slug,
        description,
        base_price,
        base_stock,
        category_id,
        product_model_no,
        how_to_apply,
        benefits,
        product_description,
        ingredients,
        tags,
        thumbnail,
        thumbnail_key,
        afterimage,
        afterimage_key,
        created_at
      FROM products
      WHERE id = $1
      `,
      [productId]
    );

    if (!productResult.rows.length) {
      return res.status(404).json({ message: "Product not found" });
    }

    const product = productResult.rows[0];

    const variantsResult = await pool.query(
      `
      SELECT 
        id,
        shade,
        color_type,
        color_panel_type,
        color_panel_value,
        stock,
        main_image,
        main_image_key,
        secondary_image,
        secondary_image_key,
        media_provider,
        price,
        discount_price,
        variant_model_no
      FROM product_variants
      WHERE product_id = $1
      ORDER BY id ASC
      `,
      [product.id]
    );

    const mediaResult = await pool.query(
      `
      SELECT id, image_url, media_type, image_key, media_provider
      FROM product_images
      WHERE product_id = $1
      ORDER BY id ASC
      `,
      [product.id]
    );

    const normalizedRequestedSlug = (requestedSlug || "").trim().toLowerCase();
    const normalizedProductSlug = (product.slug || "").trim().toLowerCase();
    const canonicalUrl = `/api/v1/product/${product.id}-${product.slug}`;
    const requestedPath = `${req.baseUrl}${req.path}`;

    const visibleVariants = variantsResult.rows.filter((variant) => {
      const isSyntheticDefault =
        variant.shade === "Default" &&
        variant.color_type === null &&
        variant.color_panel_type === null &&
        variant.color_panel_value === null &&
        String(variant.variant_model_no || "") === String(product.product_model_no || "") &&
        String(variant.main_image || "") === String(product.thumbnail || "") &&
        String(variant.secondary_image || "") === String(product.afterimage || "") &&
        Number(variant.price ?? product.base_price ?? 0) === Number(product.base_price ?? 0) &&
        Number(variant.stock ?? product.base_stock ?? 0) === Number(product.base_stock ?? 0);

      return !isSyntheticDefault;
    });

    const resolvedMedia = mediaResult.rows.map((media) => ({
      ...media,
      image_url: resolveMediaUrl(media.image_url, media.image_key, media.media_provider, 'product'),
      image_variants: buildImageKitVariants(media.image_key, media.media_provider, media.image_url),
    }));

    const primaryVariant = visibleVariants[0] || null;
    const primaryVariantResolved = primaryVariant
      ? {
          main_image: resolveMediaUrl(primaryVariant.main_image, primaryVariant.main_image_key, primaryVariant.media_provider, 'product'),
          secondary_image: resolveMediaUrl(primaryVariant.secondary_image, primaryVariant.secondary_image_key, primaryVariant.media_provider, 'product'),
          media_provider: primaryVariant.media_provider,
        }
      : null;

    const firstMediaImage = resolvedMedia.find((m) => m.media_type === 'image') || null;

    const baseThumbnail = resolveMediaUrl(product.thumbnail, product.thumbnail_key, product.media_provider, 'thumbnail');
    const baseAfterimage = resolveMediaUrl(product.afterimage, product.afterimage_key, product.media_provider, 'product');

    const finalThumbnail = primaryVariantResolved?.main_image || baseThumbnail;
    // Afterimage fallback priority: secondary image → gallery image → stored afterimage → thumbnail
    const finalAfterimage =
      primaryVariantResolved?.secondary_image ||
      firstMediaImage?.image_url ||
      baseAfterimage ||
      finalThumbnail;

    const productPayload = {
      ...product,
      tags: product.tags || [],
      thumbnail: finalThumbnail,
      afterimage: finalAfterimage,
      variants: visibleVariants.map((variant) => ({
        ...variant,
        main_image: resolveMediaUrl(variant.main_image, variant.main_image_key, variant.media_provider, 'product'),
        main_image_variants: buildImageKitVariants(variant.main_image_key, variant.media_provider, variant.main_image),
        secondary_image: resolveMediaUrl(variant.secondary_image, variant.secondary_image_key, variant.media_provider, 'product'),
        secondary_image_variants: buildImageKitVariants(variant.secondary_image_key, variant.media_provider, variant.secondary_image),
      })),
      media: resolvedMedia,
    };

    if (requestedSlug && normalizedRequestedSlug !== normalizedProductSlug) {
      if (requestedPath === canonicalUrl) {
        // Prevent redirect loops if the request already targets canonical path
        return res.json(productPayload);
      }
      return res.redirect(301, canonicalUrl);
    }

    res.json(productPayload);
  } catch (err) {
    next(err);
  }
};



/* =========================================================
   CREATE PRODUCT (FULL PROFESSIONAL VERSION)
========================================================= */
exports.createProduct = async (req, res, next) => {
  const client = await pool.connect();

  try {
    // DEBUG: Log request details
    console.log("[CREATE PRODUCT] Request received:", {
      method: req.method,
      path: req.path,
      hasFiles: !!req.files && Object.keys(req.files).length > 0,
      hasBody: !!req.body,
      bodyKeys: req.body ? Object.keys(req.body) : [],
      contentType: req.headers['content-type'],
    });

    await client.query("BEGIN");

    const {
      name,
      description,
      base_price,
      base_stock,
      product_model_no,
      how_to_apply,
      benefits,
      product_description,
      ingredients,
      thumbnail,
      afterimage,
      tags: rawTags,
      tag: legacyTag,
      variants
    } = req.body;

    console.log("[CREATE PRODUCT] Extracted fields:", {
      name: name ? "✓" : "✗",
      description: description ? "✓" : "✗",
      base_price: base_price ? "✓ " + base_price : "✗",
      base_stock: base_stock ? "✓" : "✗",
      categoryId: req.body.category_id || req.body.subcategory_id ? "✓" : "✗",
      tags: rawTags ? "✓" : legacyTag ? "✓ (legacy)" : "✗",
    });

    const categoryId = pickCategoryId(req.body);

    await ensureProductTagsColumn(client);

    const tagsValidation = normalizeTagsInput(rawTags, legacyTag, { required: true });
    if (tagsValidation.error) {
      console.error("[CREATE PRODUCT] Tags validation failed:", tagsValidation.error);
      await client.query("ROLLBACK");
      return res.status(400).json({ message: tagsValidation.error });
    }

    const { url: providedThumbnail, key: providedThumbnailKey } = deriveMediaParams(
      null,
      thumbnail || null
    );
    const { url: providedAfterimage, key: providedAfterimageKey } = deriveMediaParams(
      null,
      afterimage || null
    );

    /* -------- Basic Validation -------- */

    if (!name || !base_price || categoryId === null) {
      console.error("[CREATE PRODUCT] Validation failed:", {
        name: !!name,
        base_price: !!base_price,
        categoryId: categoryId !== null,
      });
      return res.status(400).json({
        message: "Missing required fields: name, base_price, and category_id or subcategory_id are required",
      });
    }

    // Generate a unique slug (avoid 409 conflicts on duplicate names)
    const generateUniqueSlug = async (baseName) => {
      const baseSlug = baseName
        .toLowerCase()
        .trim()
        .replace(/\s+/g, "-")
        .replace(/[^\w-]+/g, "");

      let candidate = baseSlug || "product";
      let counter = 1;

      // Use the same transaction client to avoid race conditions
      // Try suffix -2, -3, ... until free
      // (baseSlug is used if free; else append incremental counter)
      // Limit loop to prevent infinite attempts
      while (true) {
        const exists = await client.query(
          `SELECT 1 FROM products WHERE slug = $1 LIMIT 1`,
          [candidate]
        );

        if (exists.rowCount === 0) return candidate;

        counter += 1;
        candidate = `${baseSlug}-${counter}`;
        if (counter > 5000) {
          throw new Error("Unable to generate unique slug after many attempts");
        }
      }
    };

    const slug = await generateUniqueSlug(name);

    /* -------- Insert Product -------- */

    const productResult = await client.query(
      `
      INSERT INTO products 
      (name, slug, description, base_price, base_stock, category_id, product_model_no, how_to_apply, benefits, product_description, ingredients, thumbnail, afterimage, thumbnail_key, afterimage_key, tags)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
      RETURNING id
      `,
      [
        name,
        slug,
        description,
        base_price,
        Number.isFinite(parseInt(base_stock, 10)) ? parseInt(base_stock, 10) : 30,
        categoryId,
        product_model_no,
        how_to_apply,
        benefits,
        product_description,
        ingredients,
        providedThumbnail,
        providedAfterimage,
        providedThumbnailKey,
        providedAfterimageKey,
        tagsValidation.tags || [],
      ]
    );

    const productId = productResult.rows[0].id;

    await syncAutoSectionsByCategory({
      client,
      productId,
      categoryId,
    });

    /* =====================================================
       ORGANIZE FILES (Cloudinary URLs)
    ===================================================== */

    const imageFiles = req.files?.image || [];
    const galleryFiles = [
      ...(req.files?.gallery || []),
      ...(req.files?.media || [])
    ];
    const videoFiles = req.files?.video || [];

    let firstGalleryImageUrl = null;
    let firstGalleryImageKey = null;
    let secondGalleryImageUrl = null;
    let secondGalleryImageKey = null;
    let firstVariantMainImageUrl = null;
    let firstVariantMainImageKey = null;

    /* -------- Save Direct Image Uploads (as media) -------- */

    for (let file of imageFiles) {
      const { url: imageUrl, key: imageKey, provider: mediaProvider } = deriveMediaParams(file);

      await client.query(
        `
        INSERT INTO product_images
        (product_id, image_url, image_key, media_type, media_provider)
        VALUES ($1,$2,$3,$4,$5)
        `,
        [productId, imageUrl, imageKey, "image", mediaProvider || null]
      );
    }

    /* -------- Save Gallery (Cloudinary URLs) -------- */

    for (let file of galleryFiles) {
      const { url: imageUrl, key: imageKey } = deriveMediaParams(file);

      if (!firstGalleryImageUrl && imageUrl) {
        firstGalleryImageUrl = imageUrl;
        firstGalleryImageKey = imageKey;
      } else if (!secondGalleryImageUrl && imageUrl) {
        secondGalleryImageUrl = imageUrl;
        secondGalleryImageKey = imageKey;
      }

      const { provider: mediaProvider } = deriveMediaParams(file);

      await client.query(
        `
        INSERT INTO product_images
        (product_id, image_url, image_key, media_type, media_provider)
        VALUES ($1,$2,$3,$4,$5)
        `,
        [productId, imageUrl, imageKey, "image", mediaProvider || null]
      );
    }

    /* -------- Save Product Video (Cloudinary URL) -------- */

    if (videoFiles.length > 0) {
      const { url: videoUrl, key: videoKey, provider: mediaProvider } = deriveMediaParams(videoFiles[0]);

      await client.query(
        `
        INSERT INTO product_images
        (product_id, image_url, image_key, media_type, media_provider)
        VALUES ($1,$2,$3,$4,$5)
        `,
        [productId, videoUrl, videoKey, "video", mediaProvider || null]
      );
    }

    /* =====================================================
       SAVE VARIANTS
    ===================================================== */

    const parsedVariants = JSON.parse(variants || "[]");
    const hasVariants = parsedVariants.length > 0;

    for (let i = 0; i < parsedVariants.length; i++) {

      const variant = parsedVariants[i];

      // Check both naming conventions: color_X and variant_main_image_X
      const colorKey = `color_${i}`;
      const variantImageKey = `variant_main_image_${i}`;
      const secondaryColorKey = `color_secondary_${i}`;
      const secondaryVariantImageKey = `variant_secondary_image_${i}`;
      const colorPanelImageKey = `color_panel_image_${i}`;
      
      const colorFile = req.files?.[colorKey]?.[0] || req.files?.[variantImageKey]?.[0] || null;
      const secondaryColorFile =
        req.files?.[secondaryColorKey]?.[0] ||
        req.files?.[secondaryVariantImageKey]?.[0] ||
        null;
      const colorPanelFile = req.files?.[colorPanelImageKey]?.[0] || null;

      // Get Cloudinary URLs instead of local paths
      const { url: mainImagePath, key: mainImageKey, provider: mainMediaProvider } = deriveMediaParams(colorFile);

      if (!firstVariantMainImageUrl && mainImagePath) {
        firstVariantMainImageUrl = mainImagePath;
        firstVariantMainImageKey = mainImageKey;
      }

      const { url: secondaryImagePath, key: secondaryImageKey, provider: secondaryMediaProvider } =
        deriveMediaParams(secondaryColorFile);

      const colorType = variant.color_type || variant.colorType || null;

      const colorPanelUploadedUrl = colorPanelFile
        ? colorPanelFile.path || colorPanelFile.cloudinary?.secure_url
        : null;

      const wantsColorPanel =
        colorPanelFile ||
        variant.color_panel_value ||
        variant.colorPanelValue ||
        variant.color_panel_type ||
        variant.colorPanelType;

      const colorPanelValidation = validateColorPanel(
        variant.color_panel_type || variant.colorPanelType,
        variant.color_panel_value || variant.colorPanelValue,
        { requireValue: !!wantsColorPanel, uploadedUrl: colorPanelUploadedUrl }
      );

      if (colorPanelValidation.error) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          message: colorPanelValidation.error,
          variant_index: i,
          debug: colorPanelValidation.debug || null,
        });
      }

      const { colorPanelType, colorPanelValue } = colorPanelValidation;

      const variantMediaProvider = mainMediaProvider || secondaryMediaProvider || null;

      await client.query(
        `
        INSERT INTO product_variants
        (product_id, shade, color_type, color_panel_type, color_panel_value, stock, main_image, secondary_image, main_image_key, secondary_image_key, media_provider, price, discount_price, variant_model_no)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
        `,
        [
          productId,
          variant.color,
          colorType,
          colorPanelType,
          colorPanelValue,
          variant.stock || 0,
          mainImagePath,
          secondaryImagePath,
          mainImageKey,
          secondaryImageKey,
          variantMediaProvider,
          variant.price || null,
          variant.discount_price || null,
          variant.variant_model_no || null
        ]
      );
    }

    const thumbnailToSet =
      providedThumbnail || firstVariantMainImageUrl || firstGalleryImageUrl || null;
    const thumbnailKeyToSet = thumbnailToSet
      ? thumbnailToSet === providedThumbnail
        ? providedThumbnailKey
        : thumbnailToSet === firstVariantMainImageUrl
        ? firstVariantMainImageKey
        : thumbnailToSet === firstGalleryImageUrl
        ? firstGalleryImageKey
        : null
      : null;

    const autoAfterimageUrl = !hasVariants && secondGalleryImageUrl
      ? secondGalleryImageUrl
      : firstGalleryImageUrl || firstVariantMainImageUrl || null;
    const autoAfterimageKey = !hasVariants && secondGalleryImageKey
      ? secondGalleryImageKey
      : firstGalleryImageKey || firstVariantMainImageKey || null;

    const afterimageToSet = providedAfterimage || autoAfterimageUrl;
    const afterimageKeyToSet = afterimageToSet
      ? afterimageToSet === providedAfterimage
        ? providedAfterimageKey
        : afterimageToSet === secondGalleryImageUrl
        ? secondGalleryImageKey
        : afterimageToSet === firstGalleryImageUrl
        ? firstGalleryImageKey
        : afterimageToSet === firstVariantMainImageUrl
        ? firstVariantMainImageKey
        : autoAfterimageKey
      : null;

    if (thumbnailToSet || afterimageToSet || thumbnailKeyToSet || afterimageKeyToSet) {
      await client.query(
        `
        UPDATE products
        SET
          thumbnail = COALESCE(thumbnail, $2),
          thumbnail_key = COALESCE(thumbnail_key, $3),
          afterimage = COALESCE(afterimage, $4),
          afterimage_key = COALESCE(afterimage_key, $5)
        WHERE id = $1
        `,
        [productId, thumbnailToSet, thumbnailKeyToSet, afterimageToSet, afterimageKeyToSet]
      );
    }

    await client.query("COMMIT");

    res.status(201).json({
      message: "Product Created Successfully",
      product_id: productId,
      id: productId
    });

  } catch (err) {
    await client.query("ROLLBACK");
    
    console.error("[CREATE PRODUCT] Error occurred:", {
      message: err.message,
      code: err.code,
      detail: err.detail,
      stack: err.stack,
      constraint: err.constraint,
    });

    if (err.code === "23505") {
      return res.status(409).json({ message: "Product slug already exists" });
    }
    
    res.status(500).json({
      message: err.message || "Error creating product",
      debug: {
        errorCode: err.code,
        errorDetail: err.detail
      }
    });
  } finally {
    client.release();
  }
};


/* =========================================================
   UPDATE PRODUCT (FULL PROFESSIONAL VERSION)
   - PUT method for complete resource update
   - Handles product info, variants, and media updates
   - Deletes old media from Cloudinary when replaced
========================================================= */
exports.updateProduct = async (req, res, next) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    await ensureProductTagsColumn(client);

    // Accept id from multiple places; ignore literal "undefined" param
    const paramIdRaw = req.params?.id;
    const bodyIdRaw = req.body?.product_id || req.body?.productId || req.body?.id;
    const queryIdRaw = req.query?.product_id || req.query?.productId || req.query?.id;

    const firstValidId = [paramIdRaw, bodyIdRaw, queryIdRaw]
      .filter((v) => v !== undefined && v !== null && v !== "undefined" && v !== "null" && `${v}`.trim() !== "")
      .map((v) => Number(v))
      .find((v) => Number.isInteger(v));

    const productId = firstValidId;

    if (!Number.isInteger(productId)) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "Invalid product id" });
    }

    /* -------- Validate Product Exists -------- */

    const existingProduct = await client.query(
      `SELECT * FROM products WHERE id = $1`,
      [productId]
    );

    if (!existingProduct.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Product not found" });
    }

    const {
      name,
      description,
      base_price,
      base_stock,
      product_model_no,
      how_to_apply,
      benefits,
      product_description,
      ingredients,
      thumbnail,
      afterimage,
      mediaProvider,
      media_provider,
      provider,
      storageProvider,
      storage_provider,
      tags: rawTags,
      tag: legacyTag,
      variants,
      delete_media_ids,
      delete_variant_ids,
    } = req.body;

    const categoryId = pickCategoryId(req.body);
    const firstValue = (value) => (Array.isArray(value) ? value[0] : value);
    const parseNullableNumber = (value) => {
      const raw = firstValue(value);
      if (raw === undefined || raw === null || raw === "") return null;
      const n = Number(raw);
      return Number.isFinite(n) ? n : null;
    };
    const parseNullableInt = (value) => {
      const raw = firstValue(value);
      if (raw === undefined || raw === null || raw === "") return null;
      const n = parseInt(String(raw), 10);
      return Number.isFinite(n) ? n : null;
    };


    const tagsValidation = normalizeTagsInput(rawTags, legacyTag, { required: false });
    if (tagsValidation.error) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: tagsValidation.error });
    }

    /* -------- Update Product Basic Info -------- */

    const providerOverride = normalizeProviderName(
      mediaProvider || media_provider || provider || storageProvider || storage_provider
    );

    const normalizedName = Array.isArray(name)
      ? name[0]
      : name;

    const safeName = typeof normalizedName === "string"
      ? normalizedName.trim()
      : null;

    const slug = safeName
      ? safeName
          .toLowerCase()
          .replace(/\s+/g, "-")
          .replace(/[^\w-]+/g, "")
      : existingProduct.rows[0].slug;

    await client.query(
      `
      UPDATE products SET
        name = COALESCE($1, name),
        slug = COALESCE($2, slug),
        description = COALESCE($3, description),
        base_price = COALESCE($4, base_price),
        base_stock = COALESCE($5, base_stock),
        category_id = COALESCE($6, category_id),
        product_model_no = COALESCE($7, product_model_no),
        how_to_apply = COALESCE($8, how_to_apply),
        benefits = COALESCE($9, benefits),
        product_description = COALESCE($10, product_description),
        ingredients = COALESCE($11, ingredients),
        thumbnail = COALESCE($12, thumbnail),
        afterimage = COALESCE($13, afterimage),
        tags = COALESCE($14, tags),
        media_provider = COALESCE($15, media_provider)
      WHERE id = $16
      `,
      [
        safeName || null,
        safeName ? slug : null,
        description || null,
        parseNullableNumber(base_price),
        parseNullableInt(base_stock),
        categoryId,
        product_model_no || null,
        how_to_apply || null,
        benefits || null,
        product_description || null,
        ingredients || null,
        thumbnail || null,
        afterimage || null,
        tagsValidation.shouldUpdate ? tagsValidation.tags : null,
        providerOverride,
        productId,
      ]
    );

    const effectiveCategoryId =
      categoryId !== null
        ? categoryId
        : existingProduct.rows[0].category_id;

    await syncAutoSectionsByCategory({
      client,
      productId,
      categoryId: effectiveCategoryId,
    });

    /* =====================================================
       DELETE SPECIFIED MEDIA (if requested)
    ===================================================== */

    const parsedDeleteMediaIds = delete_media_ids
      ? JSON.parse(delete_media_ids)
      : [];

    if (parsedDeleteMediaIds.length > 0) {
      // Get URLs for Cloudinary deletion
      const mediaToDelete = await client.query(
        `SELECT image_url FROM product_images WHERE id = ANY($1) AND product_id = $2`,
        [parsedDeleteMediaIds, productId]
      );

      const urlsToDelete = mediaToDelete.rows.map((row) => row.image_url).filter(Boolean);

      // Delete from database
      await client.query(
        `DELETE FROM product_images WHERE id = ANY($1) AND product_id = $2`,
        [parsedDeleteMediaIds, productId]
      );

      // Delete from Cloudinary
      if (urlsToDelete.length > 0) {
        await deleteMultipleFromCloudinary(urlsToDelete);
      }
    }

    /* =====================================================
       ADD NEW MEDIA (Thumbnail/Gallery/Video)
    ===================================================== */

    const imageFiles = req.files?.image || [];
    const galleryFiles = [
      ...(req.files?.gallery || []),
      ...(req.files?.media || []),
    ];
    const videoFiles = req.files?.video || [];

    // Handle thumbnail image (from /products/:id/upload endpoint)
    if (imageFiles.length > 0) {
      const file = imageFiles[0];
      const { url: imageUrl, key: imageKey, provider } = deriveMediaParams(file);
      
      await client.query(
        `
        UPDATE products 
        SET thumbnail = $1, thumbnail_key = $2, media_provider = $3
        WHERE id = $4
        `,
        [imageUrl, imageKey, provider || 'imagekit', productId]
      );

      // Also record uploaded images in product_images for media response
      for (let file of imageFiles) {
        const { url: imgUrl, key: imgKey, provider: mediaProvider } = deriveMediaParams(file);
        await client.query(
          `
          INSERT INTO product_images
          (product_id, image_url, image_key, media_type, media_provider)
          VALUES ($1, $2, $3, $4, $5)
          `,
          [productId, imgUrl, imgKey, "image", mediaProvider || null]
        );
      }
    }

    // Save new gallery images
    for (let file of galleryFiles) {
      const { url: imageUrl, key: imageKey, provider: mediaProvider } = deriveMediaParams(file);
      
      await client.query(
        `
        INSERT INTO product_images
        (product_id, image_url, image_key, media_type, media_provider)
        VALUES ($1, $2, $3, $4, $5)
        `,
        [productId, imageUrl, imageKey, "image", mediaProvider || null]
      );
    }

    // Save new video
    if (videoFiles.length > 0) {
      const { url: videoUrl, key: videoKey, provider: mediaProvider } = deriveMediaParams(videoFiles[0]);
      
      await client.query(
        `
        INSERT INTO product_images
        (product_id, image_url, image_key, media_type, media_provider)
        VALUES ($1, $2, $3, $4, $5)
        `,
        [productId, videoUrl, videoKey, "video", mediaProvider || null]
      );
    }

    /* =====================================================
       DELETE SPECIFIED VARIANTS (if requested)
    ===================================================== */

    const parsedDeleteVariantIds = delete_variant_ids
      ? JSON.parse(delete_variant_ids)
      : [];

    if (parsedDeleteVariantIds.length > 0) {
      // Get variant images for Cloudinary deletion
      const variantsToDelete = await client.query(
        `SELECT main_image, secondary_image FROM product_variants WHERE id = ANY($1) AND product_id = $2`,
        [parsedDeleteVariantIds, productId]
      );

      const variantUrlsToDelete = variantsToDelete.rows
        .map((row) => [row.main_image, row.secondary_image])
        .flat()
        .filter(Boolean);

      // Delete from database
      await client.query(
        `DELETE FROM product_variants WHERE id = ANY($1) AND product_id = $2`,
        [parsedDeleteVariantIds, productId]
      );

      // Delete from Cloudinary
      if (variantUrlsToDelete.length > 0) {
        await deleteMultipleFromCloudinary(variantUrlsToDelete);
      }
    }

    /* =====================================================
       UPDATE/ADD VARIANTS
    ===================================================== */

    const parsedVariants = variants ? JSON.parse(variants) : [];

    for (let i = 0; i < parsedVariants.length; i++) {
      const variant = parsedVariants[i];

      // Check for variant images in request
      const colorKey = `color_${i}`;
      const variantImageKey = `variant_main_image_${i}`;
      const secondaryColorKey = `color_secondary_${i}`;
      const secondaryVariantImageKey = `variant_secondary_image_${i}`;
      const colorPanelImageKey = `color_panel_image_${i}`;

      const colorFile =
        req.files?.[colorKey]?.[0] || req.files?.[variantImageKey]?.[0] || null;
      const secondaryColorFile =
        req.files?.[secondaryColorKey]?.[0] ||
        req.files?.[secondaryVariantImageKey]?.[0] ||
        null;
      const colorPanelFile = req.files?.[colorPanelImageKey]?.[0] || null;

      const { url: mainImagePath, key: mainImageKey, provider: mainMediaProvider } = deriveMediaParams(
        colorFile,
        variant.main_image || variant.mainImage || null
      );

      const { url: secondaryImagePath, key: secondaryImageKey, provider: secondaryMediaProvider } = deriveMediaParams(
        secondaryColorFile,
        variant.secondary_image || variant.secondaryImage || null
      );

      const colorType = variant.color_type || variant.colorType || null;

      const colorPanelUploadedUrl = colorPanelFile
        ? colorPanelFile.path || colorPanelFile.cloudinary?.secure_url
        : null;

      const wantsColorPanel =
        colorPanelFile ||
        variant.color_panel_value ||
        variant.colorPanelValue ||
        variant.color_panel_type ||
        variant.colorPanelType;

      const colorPanelValidation = validateColorPanel(
        variant.color_panel_type || variant.colorPanelType,
        variant.color_panel_value || variant.colorPanelValue,
        { requireValue: !!wantsColorPanel, uploadedUrl: colorPanelUploadedUrl }
      );

      if (colorPanelValidation.error) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          message: colorPanelValidation.error,
          variant_index: i,
          debug: colorPanelValidation.debug || null,
          debug: colorPanelValidation.debug || null,
        });
      }

      const colorPanelType = colorPanelValidation.shouldUpdate
        ? colorPanelValidation.colorPanelType
        : null;

      const colorPanelValue = colorPanelValidation.shouldUpdate
        ? colorPanelValidation.colorPanelValue
        : null;

      if (variant.id) {
        /* -------- UPDATE EXISTING VARIANT -------- */

        // Get old images for potential Cloudinary deletion
        const oldVariant = await client.query(
          `SELECT main_image, secondary_image FROM product_variants WHERE id = $1 AND product_id = $2`,
          [variant.id, productId]
        );

        if (oldVariant.rows.length > 0) {
          const oldUrls = [];

          // If new main image uploaded, delete old one
          if (mainImagePath && oldVariant.rows[0].main_image) {
            oldUrls.push(oldVariant.rows[0].main_image);
          }

          // If new secondary image uploaded, delete old one
          if (secondaryImagePath && oldVariant.rows[0].secondary_image) {
            oldUrls.push(oldVariant.rows[0].secondary_image);
          }

          if (oldUrls.length > 0) {
            await deleteMultipleFromCloudinary(oldUrls);
          }

          // Update variant
          const variantMediaProvider = mainMediaProvider || secondaryMediaProvider || null;

          await client.query(
            `
            UPDATE product_variants SET
              shade = COALESCE($1, shade),
              color_type = COALESCE($2, color_type),
              color_panel_type = COALESCE($3, color_panel_type),
              color_panel_value = COALESCE($4, color_panel_value),
              stock = COALESCE($5, stock),
              main_image = COALESCE($6, main_image),
              secondary_image = COALESCE($7, secondary_image),
              main_image_key = COALESCE($8, main_image_key),
              secondary_image_key = COALESCE($9, secondary_image_key),
              media_provider = COALESCE($10, media_provider),
              price = COALESCE($11, price),
              discount_price = COALESCE($12, discount_price),
              variant_model_no = COALESCE($13, variant_model_no)
            WHERE id = $14 AND product_id = $15
            `,
            [
              variant.color || null,
              colorType,
              colorPanelType,
              colorPanelValue,
              variant.stock !== undefined ? variant.stock : null,
              mainImagePath,
              secondaryImagePath,
              mainImageKey,
              secondaryImageKey,
              variantMediaProvider,
              variant.price || null,
              variant.discount_price || null,
              variant.variant_model_no || null,
              variant.id,
              productId,
            ]
          );
        }
      } else {
        /* -------- ADD NEW VARIANT -------- */

        const variantMediaProvider = mainMediaProvider || secondaryMediaProvider || null;

        await client.query(
          `
          INSERT INTO product_variants
          (product_id, shade, color_type, color_panel_type, color_panel_value, stock, main_image, secondary_image, main_image_key, secondary_image_key, media_provider, price, discount_price, variant_model_no)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
          `,
          [
            productId,
            variant.color,
            colorType,
            colorPanelType,
            colorPanelValue,
            variant.stock || 0,
            mainImagePath,
            secondaryImagePath,
            mainImageKey,
            secondaryImageKey,
            variantMediaProvider,
            variant.price || null,
            variant.discount_price || null,
            variant.variant_model_no || null,
          ]
        );
      }
    }

    await client.query("COMMIT");

    /* -------- Fetch Updated Product -------- */

    const updatedProduct = await pool.query(
      `SELECT * FROM products WHERE id = $1`,
      [productId]
    );

    const updatedVariants = await pool.query(
      `SELECT * FROM product_variants WHERE product_id = $1`,
      [productId]
    );

    const updatedMedia = await pool.query(
      `SELECT * FROM product_images WHERE product_id = $1`,
      [productId]
    );

    const responseProduct = {
      ...updatedProduct.rows[0],
      tags: updatedProduct.rows[0]?.tags || [],
      thumbnail: resolveMediaUrl(updatedProduct.rows[0]?.thumbnail, updatedProduct.rows[0]?.thumbnail_key, updatedProduct.rows[0]?.media_provider, 'thumbnail'),
      afterimage: resolveMediaUrl(updatedProduct.rows[0]?.afterimage, updatedProduct.rows[0]?.afterimage_key, updatedProduct.rows[0]?.media_provider, 'product'),
    };

    const responseVariants = updatedVariants.rows.map((variant) => ({
      ...variant,
      main_image: resolveMediaUrl(variant.main_image, variant.main_image_key, variant.media_provider, 'product'),
      secondary_image: resolveMediaUrl(variant.secondary_image, variant.secondary_image_key, variant.media_provider, 'product'),
    }));

    const responseMedia = updatedMedia.rows.map((media) => ({
      ...media,
      image_url: resolveMediaUrl(media.image_url, media.image_key, media.media_provider, 'product'),
    }));

    res.json({
      message: "Product updated successfully",
      product: {
        ...responseProduct,
        variants: responseVariants,
        media: responseMedia,
      },
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Update Product Error:", err);
    if (err.code === "23505") {
      return res.status(409).json({
        message: "Product slug already exists",
      });
    }
    res.status(500).json({
      message: err.message || "Error updating product",
    });
  } finally {
    client.release();
  }
};


/* =========================================================
   DELETE PRODUCT (CASCADE DELETE WITH SAFETY)
========================================================= */
exports.deleteProduct = async (req, res, next) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const { id } = req.params;

    /* -------- Validate Product Exists -------- */

    const productCheck = await client.query(
      `SELECT id, name FROM products WHERE id = $1`,
      [id]
    );

    if (!productCheck.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Product not found" });
    }

    const productName = productCheck.rows[0].name;

    /* -------- Get All Image/Video URLs for Cloudinary Deletion -------- */

    const mediaResult = await client.query(
      `SELECT image_url, image_key, media_provider FROM product_images WHERE product_id = $1`,
      [id]
    );

    const variantResult = await client.query(
      `SELECT main_image, secondary_image, main_image_key, secondary_image_key, media_provider FROM product_variants WHERE product_id = $1`,
      [id]
    );

    const allMediaUrls = [
      ...mediaResult.rows.map(row => row.image_url).filter(Boolean),
      ...variantResult.rows
        .map(row => [row.main_image, row.secondary_image])
        .flat()
        .filter(Boolean)
    ];

    const s3Keys = [
      ...mediaResult.rows
        .filter((row) => (row.media_provider || '').toLowerCase() === 'imagekit')
        .map((row) => row.image_key)
        .filter(Boolean),
      ...variantResult.rows
        .filter((row) => (row.media_provider || '').toLowerCase() === 'imagekit')
        .map((row) => [row.main_image_key, row.secondary_image_key])
        .flat()
        .filter(Boolean),
    ];

    /* -------- Delete Variants (Cascade) -------- */

    await client.query(
      `DELETE FROM product_variants WHERE product_id = $1`,
      [id]
    );
    /* -------- Delete Files from Cloudinary -------- */

    if (allMediaUrls.length > 0) {
      await deleteMultipleFromCloudinary(allMediaUrls);
    }

    /* -------- Delete Files from S3 (ImageKit) -------- */

    if (s3Keys.length > 0) {
      await deleteFromS3(s3Keys);
    }

    
    /* -------- Delete Images/Media (Cascade) -------- */

    await client.query(
      `DELETE FROM product_images WHERE product_id = $1`,
      [id]
    );

    /* -------- Delete Product -------- */

    await client.query(
      `DELETE FROM products WHERE id = $1`,
      [id]
    );

    await client.query("COMMIT");

    res.json({
      message: `Product "${productName}" deleted successfully`,
      product_id: id
    });

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Delete Product Error:", err);
    next(err);
  } finally {
    client.release();
  }
};
