const pool = require("../config/db");
const { ApiError } = require("../utils/apiError");
const redisClient = require("../config/redis"); 

const REVIEW_SORT_SQL = Object.freeze({
  recent: "r.created_at DESC",
  helpful: "(r.helpful_count - r.unhelpful_count) DESC, r.created_at DESC",
  "rating-high": "r.rating DESC, r.created_at DESC",
  "rating-low": "r.rating ASC, r.created_at DESC",
});
const REVIEW_SORT_SQL_VALUES = new Set(Object.values(REVIEW_SORT_SQL));

/**
 * @desc    Get all reviews for a product with pagination
 * @route   GET /api/v1/products/:productId/reviews
 * @access  Public
 */
const getProductReviews = async (req, res, next) => {
  try {
    const { productId } = req.params;
    const { page = 1, limit = 10, sortBy = "recent" } = req.query;
    
    // Validate product ID
    if (!productId || isNaN(productId) || productId <= 0) {
      return next(
        new ApiError(400, "Valid product ID is required", "INVALID_PRODUCT_ID")
      );
    }

    // Validate pagination
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(Math.max(1, parseInt(limit)), 100); // Max 100 per page
    const offset = (pageNum - 1) * limitNum;

    const requestedSort = typeof sortBy === "string" ? sortBy : "recent";
    const orderBy = REVIEW_SORT_SQL[requestedSort] || REVIEW_SORT_SQL.recent;
    // Dynamic ORDER BY is safe because it is selected from a fixed server-side map.
    if (!REVIEW_SORT_SQL_VALUES.has(orderBy)) {
      return next(new ApiError(400, "Invalid sort option", "INVALID_SORT"));
    }

    // Check if product exists
    const productCheck = await pool.query(
      "SELECT id FROM products WHERE id = $1",
      [productId]
    );
    if (productCheck.rows.length === 0) {
      return next(
        new ApiError(404, "Product not found", "PRODUCT_NOT_FOUND")
      );
    }

    // Get total count
    const countResult = await pool.query(
      "SELECT COUNT(*) as total FROM reviews WHERE product_id = $1",
      [productId]
    );
    const totalReviews = parseInt(countResult.rows[0].total);

    // Get reviews with user and images
    const query = `
      SELECT 
        r.id,
        r.product_id,
        r.user_id,
        r.rating,
        r.title,
        r.comment,
        r.helpful_count,
        r.unhelpful_count,
        r.verified_purchase,
        r.created_at,
        r.updated_at,
        u.name as user_name,
        u.email as user_email,
        JSON_AGG(
          JSON_BUILD_OBJECT(
            'id', ri.id,
            'image_key', ri.image_key,
            'image_url', $1 || '/' || ri.image_key
          ) ORDER BY ri.image_order
        ) FILTER (WHERE ri.id IS NOT NULL) as images
      FROM reviews r
      LEFT JOIN users u ON r.user_id = u.id
      LEFT JOIN review_images ri ON r.id = ri.review_id
      WHERE r.product_id = $2
      GROUP BY r.id, r.product_id, r.user_id, r.rating, r.title, r.comment,
               r.helpful_count, r.unhelpful_count, r.verified_purchase,
               r.created_at, r.updated_at, u.name, u.email
      ORDER BY ${orderBy}
      LIMIT $3 OFFSET $4
    `;

    const result = await pool.query(query, [
      process.env.MEDIA_BASE_URL || "https://res.cloudinary.com",
      productId,
      limitNum,
      offset,
    ]);

    // Get product rating stats
    const statsResult = await pool.query(
      `SELECT 
        COALESCE(COUNT(*), 0) as total_reviews,
        COALESCE(ROUND(AVG(rating)::NUMERIC, 2), 0) as average_rating,
        COUNT(CASE WHEN rating = 5 THEN 1 END) as five_star,
        COUNT(CASE WHEN rating = 4 THEN 1 END) as four_star,
        COUNT(CASE WHEN rating = 3 THEN 1 END) as three_star,
        COUNT(CASE WHEN rating = 2 THEN 1 END) as two_star,
        COUNT(CASE WHEN rating = 1 THEN 1 END) as one_star
      FROM reviews WHERE product_id = $1`,
      [productId]
    );

    const stats = statsResult.rows[0];

    res.json({
      success: true,
      data: {
        reviews: result.rows.map((review) => ({
          id: review.id,
          productId: review.product_id,
          userId: review.user_id,
          rating: review.rating,
          title: review.title,
          comment: review.comment,
          helpfulCount: review.helpful_count,
          unhelpfulCount: review.unhelpful_count,
          verifiedPurchase: review.verified_purchase,
          images: review.images || [],
          userName: review.user_name,
          createdAt: review.created_at,
          updatedAt: review.updated_at,
        })),
        stats: {
          totalReviews: parseInt(stats.total_reviews),
          averageRating: parseFloat(stats.average_rating),
          distribution: {
            fiveStar: parseInt(stats.five_star),
            fourStar: parseInt(stats.four_star),
            threeStar: parseInt(stats.three_star),
            twoStar: parseInt(stats.two_star),
            oneStar: parseInt(stats.one_star),
          },
        },
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: totalReviews,
          pages: Math.ceil(totalReviews / limitNum),
        },
      },
      message: "Reviews retrieved successfully",
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get single review by ID
 * @route   GET /api/v1/reviews/:reviewId
 * @access  Public
 */
const getReviewById = async (req, res, next) => {
  try {
    const { reviewId } = req.params;

    if (!reviewId || isNaN(reviewId) || reviewId <= 0) {
      return next(
        new ApiError(400, "Valid review ID is required", "INVALID_REVIEW_ID")
      );
    }

    const query = `
      SELECT 
        r.id,
        r.product_id,
        r.user_id,
        r.rating,
        r.title,
        r.comment,
        r.helpful_count,
        r.unhelpful_count,
        r.verified_purchase,
        r.created_at,
        r.updated_at,
        u.name as user_name,
        u.email as user_email,
        JSON_AGG(
          JSON_BUILD_OBJECT(
            'id', ri.id,
            'image_key', ri.image_key,
            'image_url', $1 || '/' || ri.image_key
          ) ORDER BY ri.image_order
        ) FILTER (WHERE ri.id IS NOT NULL) as images
      FROM reviews r
      LEFT JOIN users u ON r.user_id = u.id
      LEFT JOIN review_images ri ON r.id = ri.review_id
      WHERE r.id = $2
      GROUP BY r.id, u.id
    `;

    const result = await pool.query(query, [
      process.env.MEDIA_BASE_URL || "https://res.cloudinary.com",
      reviewId,
    ]);

    if (result.rows.length === 0) {
      return next(new ApiError(404, "Review not found", "REVIEW_NOT_FOUND"));
    }

    const review = result.rows[0];

    res.json({
      success: true,
      data: {
        id: review.id,
        productId: review.product_id,
        userId: review.user_id,
        rating: review.rating,
        title: review.title,
        comment: review.comment,
        helpfulCount: review.helpful_count,
        unhelpfulCount: review.unhelpful_count,
        verifiedPurchase: review.verified_purchase,
        images: review.images || [],
        userName: review.user_name,
        createdAt: review.created_at,
        updatedAt: review.updated_at,
      },
      message: "Review retrieved successfully",
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Create new review for a product
 * @route   POST /api/v1/products/:productId/reviews
 * @access  Private (Auth required)
 * @param   {number} rating - 1-5 stars (required)
 * @param   {string} title - Review title (required, max 255)
 * @param   {string} comment - Review comment (optional, max 2000)
 * @param   {files} images - Review images from Cloudinary (optional, max 5)
 */
const createReview = async (req, res, next) => {
  try {
    const { productId } = req.params;
    const { rating, title, comment } = req.body;
    const userId = req.user.id;

    // Validation: Product ID
    if (!productId || isNaN(productId) || productId <= 0) {
      return next(
        new ApiError(400, "Valid product ID is required", "INVALID_PRODUCT_ID")
      );
    }

    // Validation: Rating
    if (!rating || isNaN(rating) || rating < 1 || rating > 5) {
      return next(
        new ApiError(400, "Rating must be between 1 and 5", "INVALID_RATING")
      );
    }

    // Validation: Title
    if (!title || typeof title !== "string" || title.trim().length === 0) {
      return next(
        new ApiError(400, "Review title is required", "MISSING_TITLE")
      );
    }

    if (title.length > 255) {
      return next(
        new ApiError(400, "Review title cannot exceed 255 characters", "TITLE_TOO_LONG")
      );
    }

    // Validation: Comment (optional but if provided, check length)
    if (comment && typeof comment === "string" && comment.length > 2000) {
      return next(
        new ApiError(400, "Comment cannot exceed 2000 characters", "COMMENT_TOO_LONG")
      );
    }

    // Check if product exists
    const productCheck = await pool.query(
      "SELECT id FROM products WHERE id = $1",
      [productId]
    );
    if (productCheck.rows.length === 0) {
      return next(
        new ApiError(404, "Product not found", "PRODUCT_NOT_FOUND")
      );
    }

    // Check if user already reviewed this product
    const existingReview = await pool.query(
      "SELECT id FROM reviews WHERE product_id = $1 AND user_id = $2",
      [productId, userId]
    );
    if (existingReview.rows.length > 0) {
      return next(
        new ApiError(
          409,
          "You have already reviewed this product",
          "DUPLICATE_REVIEW"
        )
      );
    }

    // Check if user purchased this product (for verified_purchase flag)
    // Note: Verified purchase is set based on order existence
    let verifiedPurchase = false;
    try {
      const purchaseCheck = await pool.query(
        `SELECT 1 FROM order_items oi
         JOIN orders o ON oi.order_id = o.id
         WHERE oi.product_id = $1 AND o.user_id = $2
         LIMIT 1`,
        [productId, userId]
      );
      verifiedPurchase = purchaseCheck.rows.length > 0;
    } catch (err) {
      // If order check fails, default to false
      verifiedPurchase = false;
    }

    // Insert review
    const reviewResult = await pool.query(
      `INSERT INTO reviews (product_id, user_id, rating, title, comment, verified_purchase)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [productId, userId, rating, title.trim(), comment?.trim() || null, verifiedPurchase]
    );

    const reviewId = reviewResult.rows[0].id;

    // Process images if provided
    let imageIds = [];
    if (req.files && req.files.length > 0) {
      const maxImages = 5;
      const imagesToProcess = req.files.slice(0, maxImages);

      for (let i = 0; i < imagesToProcess.length; i++) {
        const file = imagesToProcess[i];
        const imageInsert = await pool.query(
          `INSERT INTO review_images (review_id, image_key, image_order)
           VALUES ($1, $2, $3)
           RETURNING id`,
          [reviewId, file.filename || file.path, i]
        );
        imageIds.push(imageInsert.rows[0].id);
      }
    }

    // Invalidate cache for product reviews
    try {
      await redisClient?.del(`product:${productId}:reviews`);
    } catch (cacheError) {
      // Graceful cache error handling - don't fail the request
      console.warn("Cache invalidation warning:", cacheError.message);
    }

    // Get created review with full details
    const finalReview = await pool.query(
      `SELECT 
        r.id,
        r.product_id,
        r.user_id,
        r.rating,
        r.title,
        r.comment,
        r.helpful_count,
        r.unhelpful_count,
        r.verified_purchase,
        r.created_at,
        r.updated_at,
        u.name as user_name,
        u.email as user_email,
        JSON_AGG(
          JSON_BUILD_OBJECT(
            'id', ri.id,
            'image_key', ri.image_key,
            'image_url', $1 || '/' || ri.image_key
          ) ORDER BY ri.image_order
        ) FILTER (WHERE ri.id IS NOT NULL) as images
      FROM reviews r
      LEFT JOIN users u ON r.user_id = u.id
      LEFT JOIN review_images ri ON r.id = ri.review_id
      WHERE r.id = $2
      GROUP BY r.id, u.id`,
      [process.env.MEDIA_BASE_URL || "https://res.cloudinary.com", reviewId]
    );

    const review = finalReview.rows[0];

    res.status(201).json({
      success: true,
      data: {
        id: review.id,
        productId: review.product_id,
        userId: review.user_id,
        rating: review.rating,
        title: review.title,
        comment: review.comment,
        helpfulCount: review.helpful_count,
        unhelpfulCount: review.unhelpful_count,
        verifiedPurchase: review.verified_purchase,
        images: review.images || [],
        userName: review.user_name,
        createdAt: review.created_at,
      },
      message: "Review created successfully",
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Update a review
 * @route   PUT /api/v1/reviews/:reviewId
 * @access  Private (Auth required - owner only)
 */
const updateReview = async (req, res, next) => {
  try {
    const { reviewId } = req.params;
    const { rating, title, comment } = req.body;
    const userId = req.user.id;

    if (!reviewId || isNaN(reviewId) || reviewId <= 0) {
      return next(
        new ApiError(400, "Valid review ID is required", "INVALID_REVIEW_ID")
      );
    }

    // Get review and check ownership
    const reviewCheck = await pool.query(
      "SELECT id, product_id, user_id FROM reviews WHERE id = $1",
      [reviewId]
    );

    if (reviewCheck.rows.length === 0) {
      return next(new ApiError(404, "Review not found", "REVIEW_NOT_FOUND"));
    }

    const review = reviewCheck.rows[0];
    if (review.user_id !== userId) {
      return next(
        new ApiError(403, "Not authorized to update this review", "UNAUTHORIZED")
      );
    }

    // Validate inputs if provided
    if (rating && (isNaN(rating) || rating < 1 || rating > 5)) {
      return next(
        new ApiError(400, "Rating must be between 1 and 5", "INVALID_RATING")
      );
    }

    if (title && title.length > 255) {
      return next(
        new ApiError(400, "Title cannot exceed 255 characters", "TITLE_TOO_LONG")
      );
    }

    if (comment && comment.length > 2000) {
      return next(
        new ApiError(400, "Comment cannot exceed 2000 characters", "COMMENT_TOO_LONG")
      );
    }

    // Build update query
    const updates = [];
    const values = [reviewId];
    let paramCount = 2;

    if (rating) {
      updates.push(`rating = $${paramCount}`);
      values.push(rating);
      paramCount++;
    }

    if (title) {
      updates.push(`title = $${paramCount}`);
      values.push(title.trim());
      paramCount++;
    }

    if (comment) {
      updates.push(`comment = $${paramCount}`);
      values.push(comment.trim());
      paramCount++;
    }

    if (updates.length === 0) {
      return next(
        new ApiError(400, "No valid fields to update", "NO_UPDATES")
      );
    }

    const updateQuery = `
      UPDATE reviews
      SET ${updates.join(", ")}, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING *
    `;

    const result = await pool.query(updateQuery, values);

    // Invalidate cache
    try {
      await redisClient?.del(`product:${review.product_id}:reviews`);
    } catch (cacheError) {
      console.warn("Cache invalidation warning:", cacheError.message);
    }

    res.json({
      success: true,
      data: result.rows[0],
      message: "Review updated successfully",
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Delete a review
 * @route   DELETE /api/v1/reviews/:reviewId
 * @access  Private (Auth required - owner or admin)
 */
const deleteReview = async (req, res, next) => {
  try {
    const { reviewId } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    if (!reviewId || isNaN(reviewId) || reviewId <= 0) {
      return next(
        new ApiError(400, "Valid review ID is required", "INVALID_REVIEW_ID")
      );
    }

    // Get review and check ownership or admin role
    const reviewCheck = await pool.query(
      "SELECT id, product_id, user_id FROM reviews WHERE id = $1",
      [reviewId]
    );

    if (reviewCheck.rows.length === 0) {
      return next(new ApiError(404, "Review not found", "REVIEW_NOT_FOUND"));
    }

    const review = reviewCheck.rows[0];
    if (review.user_id !== userId && userRole !== "admin") {
      return next(
        new ApiError(403, "Not authorized to delete this review", "UNAUTHORIZED")
      );
    }

    // Delete review (cascade will delete images)
    await pool.query("DELETE FROM reviews WHERE id = $1", [reviewId]);

    // Invalidate cache
    try {
      await redisClient?.del(`product:${review.product_id}:reviews`);
    } catch (cacheError) {
      console.warn("Cache invalidation warning:", cacheError.message);
    }

    res.json({
      success: true,
      message: "Review deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Mark review as helpful
 * @route   POST /api/v1/reviews/:reviewId/helpful
 * @access  Public
 */
const markHelpful = async (req, res, next) => {
  try {
    const { reviewId } = req.params;
    const { helpful = true } = req.body;

    if (!reviewId || isNaN(reviewId) || reviewId <= 0) {
      return next(
        new ApiError(400, "Valid review ID is required", "INVALID_REVIEW_ID")
      );
    }

    // Check if review exists
    const reviewCheck = await pool.query(
      "SELECT id, product_id FROM reviews WHERE id = $1",
      [reviewId]
    );

    if (reviewCheck.rows.length === 0) {
      return next(new ApiError(404, "Review not found", "REVIEW_NOT_FOUND"));
    }

    const column = helpful ? "helpful_count" : "unhelpful_count";
    const updateQuery = `
      UPDATE reviews
      SET ${column} = ${column} + 1
      WHERE id = $1
      RETURNING id, helpful_count, unhelpful_count
    `;

    const result = await pool.query(updateQuery, [reviewId]);

    // Invalidate cache
    try {
      const review = reviewCheck.rows[0];
      await redisClient?.del(`product:${review.product_id}:reviews`);
    } catch (cacheError) {
      console.warn("Cache invalidation warning:", cacheError.message);
    }

    res.json({
      success: true,
      data: result.rows[0],
      message: `Review marked as ${helpful ? "helpful" : "unhelpful"}`,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getProductReviews,
  getReviewById,
  createReview,
  updateReview,
  deleteReview,
  markHelpful,
};
