const router = require("express").Router();
const pool = require("../config/db");

const BASE_URL = "https://www.justgoldcosmetics.com";
const SITEMAP_NS = "http://www.sitemaps.org/schemas/sitemap/0.9";
const IMAGE_NS = "http://www.google.com/schemas/sitemap-image/1.1";
const SITEMAP_CACHE_CONTROL = "public, max-age=3600";
const MAX_URLS_PER_SITEMAP = 50000;
const PRODUCT_BATCH_SIZE = 2000;

const TABLE_COLUMNS_CACHE = new Map();

const toDate = (value) => {
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) return new Date();
  return d;
};

const toDateOnly = (value) => {
  const d = toDate(value);
  return d.toISOString().slice(0, 10);
};

const sanitizeXmlText = (value) => {
  if (value === undefined || value === null) return "";
  return String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
};

const escapeXml = (value) =>
  sanitizeXmlText(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const normalizeWhitespace = (value) => sanitizeXmlText(value).replace(/\s+/g, " ").trim();

const isAbsoluteHttpsUrl = (value) => {
  if (!value || typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:";
  } catch {
    return false;
  }
};

const setSitemapHeaders = (res, status = 200) => {
  res.status(status);
  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  res.setHeader("Cache-Control", SITEMAP_CACHE_CONTROL);
};

const sendXml = (res, status, xml) => {
  setSitemapHeaders(res, status);
  res.send(xml);
};

const sendXmlError = (res, status = 500) => {
  sendXml(
    res,
    status,
    `<?xml version="1.0" encoding="UTF-8"?><error><message>Unable to generate sitemap</message></error>`
  );
};

const getTableColumns = async (tableName) => {
  if (TABLE_COLUMNS_CACHE.has(tableName)) {
    return TABLE_COLUMNS_CACHE.get(tableName);
  }

  const { rows } = await pool.query(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
    `,
    [tableName]
  );

  const set = new Set(rows.map((r) => r.column_name));
  TABLE_COLUMNS_CACHE.set(tableName, set);
  return set;
};

const getLatestLastmod = async (tableName) => {
  const columns = await getTableColumns(tableName);
  const hasUpdatedAt = columns.has("updated_at");
  const hasCreatedAt = columns.has("created_at");
  const dateExpr = hasUpdatedAt ? "updated_at" : hasCreatedAt ? "created_at" : "NOW()";

  const { rows } = await pool.query(`SELECT MAX(${dateExpr}) AS lastmod FROM ${tableName}`);
  return toDateOnly(rows[0]?.lastmod || new Date());
};

const getProductsSitemapMeta = async () => {
  const columns = await getTableColumns("products");
  const hasUpdatedAt = columns.has("updated_at");
  const hasCreatedAt = columns.has("created_at");
  const hasIsActive = columns.has("is_active");
  const hasImage = columns.has("image");
  const hasThumbnail = columns.has("thumbnail");
  const hasAfterimage = columns.has("afterimage");
  const hasDescription = columns.has("description");
  const hasProductDescription = columns.has("product_description");
  const hasCategoryId = columns.has("category_id");

  const lastmodExpr = hasUpdatedAt ? "p.updated_at" : hasCreatedAt ? "p.created_at" : "NOW()";
  const imageExpr = hasImage
    ? "p.image"
    : hasThumbnail && hasAfterimage
      ? "COALESCE(p.thumbnail, p.afterimage)"
      : hasThumbnail
        ? "p.thumbnail"
        : hasAfterimage
          ? "p.afterimage"
          : "NULL";

  const descriptionExpr = hasProductDescription
    ? "p.product_description"
    : hasDescription
      ? "p.description"
      : "NULL";

  const joinCategory = hasCategoryId ? "LEFT JOIN categories c ON c.id = p.category_id" : "";
  const categoryExpr = hasCategoryId ? "c.name" : "NULL";
  const isActiveFilter = hasIsActive ? "AND COALESCE(p.is_active, true) = true" : "";

  const { rows: countRows } = await pool.query(
    `
      SELECT COUNT(*)::bigint AS total
      FROM products p
      WHERE p.slug IS NOT NULL AND p.slug <> ''
      ${isActiveFilter}
    `
  );

  const { rows: lastmodRows } = await pool.query(
    `
      SELECT MAX(${lastmodExpr}) AS lastmod
      FROM products p
      WHERE p.slug IS NOT NULL AND p.slug <> ''
      ${isActiveFilter}
    `
  );

  return {
    total: Number(countRows[0]?.total || 0),
    lastmod: toDateOnly(lastmodRows[0]?.lastmod || new Date()),
    lastmodExpr,
    imageExpr,
    descriptionExpr,
    categoryExpr,
    joinCategory,
    isActiveFilter,
  };
};

const buildProductsPageQuery = ({ lastmodExpr, imageExpr, descriptionExpr, categoryExpr, joinCategory, isActiveFilter }) => `
  SELECT
    p.slug,
    p.name,
    ${descriptionExpr} AS description,
    ${categoryExpr} AS category_name,
    ${lastmodExpr} AS updated_at,
    ${imageExpr} AS image
  FROM products p
  ${joinCategory}
  WHERE p.slug IS NOT NULL AND p.slug <> ''
  ${isActiveFilter}
  ORDER BY p.slug ASC
  LIMIT $1 OFFSET $2
`;

const streamProductsPage = async (res, page) => {
  const meta = await getProductsSitemapMeta();
  const totalPages = Math.max(1, Math.ceil(meta.total / MAX_URLS_PER_SITEMAP));

  if (page < 1 || page > totalPages) {
    sendXmlError(res, 404);
    return;
  }

  setSitemapHeaders(res, 200);
  res.write(`<?xml version="1.0" encoding="UTF-8"?>`);
  res.write(`<urlset xmlns="${SITEMAP_NS}" xmlns:image="${IMAGE_NS}">`);

  const baseOffset = (page - 1) * MAX_URLS_PER_SITEMAP;
  let written = 0;
  const seen = new Set();
  const query = buildProductsPageQuery(meta);

  while (written < MAX_URLS_PER_SITEMAP) {
    const batchLimit = Math.min(PRODUCT_BATCH_SIZE, MAX_URLS_PER_SITEMAP - written);
    const offset = baseOffset + written;
    const { rows } = await pool.query(query, [batchLimit, offset]);
    if (!rows.length) break;

    for (const product of rows) {
      const slug = normalizeWhitespace(product.slug);
      if (!slug) continue;

      const loc = `${BASE_URL}/product/${encodeURIComponent(slug)}`;
      if (seen.has(loc)) continue;
      seen.add(loc);

      res.write("<url>");
      res.write(`<loc>${escapeXml(loc)}</loc>`);
      res.write(`<lastmod>${toDateOnly(product.updated_at)}</lastmod>`);
      res.write("<changefreq>weekly</changefreq>");
      res.write("<priority>0.8</priority>");

      const imageUrl = normalizeWhitespace(product.image);
      if (isAbsoluteHttpsUrl(imageUrl)) {
        const title = normalizeWhitespace(product.name);
        const captionRaw = normalizeWhitespace(product.description) || normalizeWhitespace(product.category_name);

        res.write("<image:image>");
        res.write(`<image:loc>${escapeXml(imageUrl)}</image:loc>`);
        if (title) {
          res.write(`<image:title>${escapeXml(title)}</image:title>`);
        }
        if (captionRaw) {
          res.write(`<image:caption>${escapeXml(captionRaw)}</image:caption>`);
        }
        res.write("</image:image>");
      }

      res.write("</url>");
      written += 1;
    }

    if (rows.length < batchLimit) break;
  }

  res.write("</urlset>");
  res.end();
};

const getCategoriesForSitemap = async () => {
  const columns = await getTableColumns("categories");

  const hasUpdatedAt = columns.has("updated_at");
  const hasCreatedAt = columns.has("created_at");

  const lastmodExpr = hasUpdatedAt
    ? "updated_at"
    : hasCreatedAt
      ? "created_at"
      : "NOW()";

  const { rows } = await pool.query(
    `
      SELECT slug, ${lastmodExpr} AS updated_at
      FROM categories
      WHERE slug IS NOT NULL AND slug <> ''
      ORDER BY slug ASC
    `
  );

  return rows;
};

router.get("/sitemap.xml", async (req, res) => {
  try {
    const productsMeta = await getProductsSitemapMeta();
    const productsPages = Math.max(1, Math.ceil(productsMeta.total / MAX_URLS_PER_SITEMAP));
    const categoriesLastmod = await getLatestLastmod("categories");
    const pagesLastmod = toDateOnly(new Date());

    const productEntries = [];
    if (productsPages > 1) {
      for (let page = 1; page <= productsPages; page += 1) {
        productEntries.push(
          `<sitemap><loc>${BASE_URL}/sitemap-products-${page}.xml</loc><lastmod>${productsMeta.lastmod}</lastmod></sitemap>`
        );
      }
    } else {
      productEntries.push(
        `<sitemap><loc>${BASE_URL}/sitemap-products.xml</loc><lastmod>${productsMeta.lastmod}</lastmod></sitemap>`
      );
    }

    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      `<sitemapindex xmlns="${SITEMAP_NS}">`,
      ...productEntries,
      `<sitemap><loc>${BASE_URL}/sitemap-categories.xml</loc><lastmod>${categoriesLastmod}</lastmod></sitemap>`,
      `<sitemap><loc>${BASE_URL}/sitemap-pages.xml</loc><lastmod>${pagesLastmod}</lastmod></sitemap>`,
      "</sitemapindex>",
    ].join("");

    sendXml(res, 200, xml);
  } catch {
    sendXmlError(res, 500);
  }
});

router.get("/sitemap-products.xml", async (req, res) => {
  try {
    await streamProductsPage(res, 1);
  } catch {
    sendXmlError(res, 500);
  }
});

router.get(/^\/sitemap-products-(\d+)\.xml$/, async (req, res) => {
  try {
    const page = Number.parseInt(req.params[0], 10);
    await streamProductsPage(res, Number.isInteger(page) ? page : NaN);
  } catch {
    sendXmlError(res, 500);
  }
});

router.get("/sitemap-categories.xml", async (req, res) => {
  try {
    const categories = await getCategoriesForSitemap();
    const seen = new Set();

    setSitemapHeaders(res, 200);
    res.write(`<?xml version="1.0" encoding="UTF-8"?>`);
    res.write(`<urlset xmlns="${SITEMAP_NS}" xmlns:image="${IMAGE_NS}">`);

    for (const category of categories) {
      const slug = normalizeWhitespace(category.slug);
      if (!slug) continue;
      const loc = `${BASE_URL}/category/${encodeURIComponent(slug)}`;
      if (seen.has(loc)) continue;
      seen.add(loc);

      res.write("<url>");
      res.write(`<loc>${escapeXml(loc)}</loc>`);
      res.write(`<lastmod>${toDateOnly(category.updated_at)}</lastmod>`);
      res.write("<changefreq>daily</changefreq>");
      res.write("<priority>0.9</priority>");
      res.write("</url>");
    }

    res.write("</urlset>");
    res.end();
  } catch {
    sendXmlError(res, 500);
  }
});

router.get("/sitemap-pages.xml", async (req, res) => {
  try {
    const now = toDateOnly(new Date());
    const pages = [
      { path: "/", priority: "1.0" },
      { path: "/shop", priority: "0.9" },
      { path: "/about", priority: "0.7" },
      { path: "/contact", priority: "0.6" },
    ];

    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      `<urlset xmlns="${SITEMAP_NS}" xmlns:image="${IMAGE_NS}">`,
      ...pages.map(
        (p) =>
          `<url><loc>${BASE_URL}${p.path}</loc><lastmod>${now}</lastmod><changefreq>weekly</changefreq><priority>${p.priority}</priority></url>`
      ),
      "</urlset>",
    ].join("");

    sendXml(res, 200, xml);
  } catch {
    sendXmlError(res, 500);
  }
});

module.exports = router;
