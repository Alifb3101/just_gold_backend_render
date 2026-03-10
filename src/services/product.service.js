const PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;
const TAG_CODE_FILTER_REGEX = /^[A-Z0-9_-]{1,24}$/;

const SORT_OPTIONS = {
	price_low: { orderBy: "effective_price", direction: "ASC" },
	price_high: { orderBy: "effective_price", direction: "DESC" },
	newest: { orderBy: "p.created_at", direction: "DESC" },
	popular: { orderBy: "p.base_stock", direction: "DESC" },
};

const toNumber = (raw) => {
	// Treat undefined, null, and empty string as null to avoid accidental 0 filters
	if (raw === undefined || raw === null || raw === "") return null;
	const value = Number(raw);
	return Number.isFinite(value) ? value : null;
};

const toPositiveInt = (raw) => {
	const value = toNumber(raw);
	if (value === null) return null;
	const intValue = Math.trunc(value);
	return intValue >= 1 ? intValue : null;
};

const clampPageSize = (rawLimit) => {
	const limit = toPositiveInt(rawLimit);
	if (limit === null) return PAGE_SIZE;
	return Math.min(Math.max(limit, 1), MAX_PAGE_SIZE);
};

const normalizeSearchTerm = (raw) => {
	if (raw === undefined || raw === null) return null;
	const value = String(raw).trim();
	if (!value.length) return null;
	return value.toLowerCase();
};

const normalizeTagCode = (raw) => {
	if (raw === undefined || raw === null) return null;
	const value = String(raw).trim();
	if (!value.length) return null;
	const upper = value.toUpperCase();
	return TAG_CODE_FILTER_REGEX.test(upper) ? upper : null;
};

const buildTsQuery = (searchTerm) => {
	if (!searchTerm) return null;
	const tokens = searchTerm
		.split(/\s+/)
		.flatMap((t) => t.split(/[-]+/))
		.map((t) => t.replace(/[^a-zA-Z0-9]+/g, ""))
		.filter((t) => t.length > 0);
	if (!tokens.length) return null;
	// Prefix-match per token using :* to keep progressive matches.
	return tokens.map((t) => `${t}:*`).join(" & ");
};

const normalizeFilters = (filters) => {
	return {
		categoryId: toNumber(filters.categoryId),
		minPrice: toNumber(filters.minPrice),
		maxPrice: toNumber(filters.maxPrice),
		color: filters.color ? String(filters.color).trim() : null,
		size: filters.size ? String(filters.size).trim() : null,
		tagCode: normalizeTagCode(filters.tagCode ?? filters.tag),
		sort: SORT_OPTIONS[filters.sort] ? filters.sort : "newest",
		cursor: toNumber(filters.cursor),
		page: toPositiveInt(filters.page),
		limit: clampPageSize(filters.limit),
		search: normalizeSearchTerm(filters.search),
	};
};

const buildCacheKey = (filters) => {
	const normalized = normalizeFilters(filters);
	const paginationMode = normalized.cursor !== null ? "cursor" : (filters.page !== undefined || filters.limit !== undefined ? "page" : "cursor");
	const parts = [
		`cat:${normalized.categoryId ?? "all"}`,
		`min:${normalized.minPrice ?? "none"}`,
		`max:${normalized.maxPrice ?? "none"}`,
		`color:${normalized.color ?? "all"}`,
		`size:${normalized.size ?? "all"}`,
		`tag:${normalized.tagCode ?? "all"}`,
		`sort:${normalized.sort}`,
		`mode:${paginationMode}`,
		`cursor:${normalized.cursor ?? 0}`,
		`page:${normalized.page ?? 1}`,
		`limit:${normalized.limit ?? PAGE_SIZE}`,
		`search:${normalized.search ? normalized.search.toLowerCase() : "none"}`,
	];
	return `products:${parts.join("|")}`;
};

const buildProductsQuery = (rawFilters = {}) => {
	const filters = normalizeFilters(rawFilters);
	const values = [];
	const where = ["p.is_active = true"];
	const searchTerm = filters.search;
	const tsQuery = buildTsQuery(searchTerm);

	if (filters.categoryId !== null) {
		values.push(filters.categoryId);
		const idx = values.length;
		// Match products saved under a subcategory by accepting either the category id or its parent id.
		where.push(`(
			EXISTS (SELECT 1 FROM categories c WHERE c.id = p.category_id AND (c.id = $${idx} OR c.parent_id = $${idx}))
			OR EXISTS (
				SELECT 1
				FROM product_sections ps
				JOIN sections s ON s.id = ps.section_id
				WHERE ps.product_id = p.id
				AND s.name = CASE $${idx}
					WHEN 2 THEN 'new_arrivals'
					WHEN 3 THEN 'best_seller'
					ELSE '__none__'
				END
			)
		)`);
	}

	if (filters.minPrice !== null) {
		values.push(filters.minPrice);
		where.push(`COALESCE(variant.price, p.base_price) >= $${values.length}`);
	}

	if (filters.tagCode) {
		values.push(filters.tagCode);
		where.push(
			`EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(p.tags, '[]'::jsonb)) tag_elem WHERE UPPER(tag_elem->>'code') = $${values.length})`
		);
	}

	if (filters.maxPrice !== null) {
		values.push(filters.maxPrice);
		where.push(`COALESCE(variant.price, p.base_price) <= $${values.length}`);
	}

	if (filters.color) {
		values.push(`%${filters.color}%`);
		const idx = values.length;
		where.push(
			`EXISTS (SELECT 1 FROM product_variants pv_color WHERE pv_color.product_id = p.id AND (pv_color.shade ILIKE $${idx} OR pv_color.color_type ILIKE $${idx}))`
		);
	}

	if (filters.size) {
		values.push(filters.size);
		where.push(
			`EXISTS (SELECT 1 FROM product_variants pv_size WHERE pv_size.product_id = p.id AND pv_size.variant_model_no = $${values.length})`
		);
	}

	if (tsQuery) {
		values.push(tsQuery);
		const searchIdx = values.length;
		where.push(
			`(p.search_vector @@ to_tsquery('simple', $${searchIdx}) OR similarity(p.name_unaccent, unaccent($${searchIdx})) > 0.25)`
		);
	}

	const sortMeta = SORT_OPTIONS[filters.sort] || SORT_OPTIONS.newest;
	const cursorOp = sortMeta.direction === "ASC" ? ">" : "<";
	const useOffsetPagination = filters.cursor === null && (rawFilters.page !== undefined || rawFilters.limit !== undefined);
	const pageSize = filters.limit;

	if (filters.cursor !== null) {
		values.push(filters.cursor);
		where.push(`p.id ${cursorOp} $${values.length}`);
	}

	let offsetClause = "";
	if (useOffsetPagination) {
		const page = filters.page ?? 1;
		const offset = (page - 1) * pageSize;
		values.push(offset);
		offsetClause = `\n\t\tOFFSET $${values.length}`;
	}

	const orderClause = `${sortMeta.orderBy} ${sortMeta.direction}, p.id ${sortMeta.direction}`;

	const text = `
		SELECT
			p.id,
			p.name,
			p.slug,
			p.description,
			p.category_id,
			p.base_price,
			p.base_stock,
			p.tags,
			p.thumbnail,
			p.thumbnail_key,
			p.afterimage,
			p.afterimage_key,
			p.created_at,
			COALESCE(variant.price, p.base_price) AS effective_price
		FROM products p
		LEFT JOIN LATERAL (
			SELECT pv.price, pv.shade, pv.variant_model_no
			FROM product_variants pv
			WHERE pv.product_id = p.id
			ORDER BY pv.price NULLS LAST
			LIMIT 1
		) AS variant ON TRUE
		WHERE ${where.join(" AND ")}
		ORDER BY ${orderClause}
		LIMIT ${pageSize + 1}${offsetClause}
	`;

	return { text, values, limit: pageSize, mode: useOffsetPagination ? "page" : "cursor", page: filters.page ?? 1 };
};

module.exports = {
	PAGE_SIZE,
	SORT_OPTIONS,
	buildProductsQuery,
	buildCacheKey,
	normalizeFilters,
};
