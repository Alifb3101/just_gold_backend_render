const express = require("express");
const router = express.Router();
const multer = require("multer");
const authMiddleware = require("../middlewares/auth.middleware");
const { reviewImageStorage } = require("../config/cloudinary");
const {
  getProductReviews,
  getReviewById,
  createReview,
  updateReview,
  deleteReview,
  markHelpful,
} = require("../controllers/review.controller");

/* ============================================================
   REVIEW ROUTES
   - Public GET endpoints for reading reviews
   - Private POST/PUT/DELETE for authenticated users
   - Image upload support for review creation
============================================================ */

// Configure multer for review image uploads (max 5 images)
const reviewUpload = multer({
  storage: reviewImageStorage,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB per file
  },
  fileFilter: (req, file, cb) => {
    // Validate image formats
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(
      file.originalname.toLowerCase().split(".").pop()
    );
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error("Only image files (JPEG, PNG, GIF, WebP) are allowed!"));
    }
  },
});

// ============================================================
// GET ROUTES (Public)
// ============================================================

/**
 * @route   GET /api/v1/products/:productId/reviews
 * @desc    Get all reviews for a product with pagination and sorting
 * @access  Public
 * @query   {number} page - Page number (default: 1)
 * @query   {number} limit - Items per page (default: 10, max: 100)
 * @query   {string} sortBy - Sort option: 'recent', 'helpful', 'rating-high', 'rating-low'
 */
router.get("/products/:productId/reviews", getProductReviews);

/**
 * @route   GET /api/v1/reviews/:reviewId
 * @desc    Get single review by ID with all images
 * @access  Public
 */
router.get("/reviews/:reviewId", getReviewById);

// ============================================================
// POST ROUTES (Private - Authentication Required)
// ============================================================

/**
 * @route   POST /api/v1/products/:productId/reviews
 * @desc    Create a new review for a product
 * @access  Private (Auth required)
 * @headers {string} Authorization - Bearer token
 * @body    {number} rating - Rating 1-5 (required)
 * @body    {string} title - Review title max 255 chars (required)
 * @body    {string} comment - Review comment max 2000 chars (optional)
 * @files   {file[]} images - Up to 5 review images (optional)
 * @returns {object} Created review with images
 *
 * @example POST /api/v1/products/5/reviews
 * Headers: Authorization: Bearer <token>
 * Body: {
 *   "rating": 5,
 *   "title": "Best product ever!",
 *   "comment": "High quality and fast delivery",
 *   "images": [file1, file2, ...]
 * }
 */
router.post(
  "/products/:productId/reviews",
  authMiddleware,
  reviewUpload.array("images", 5),
  createReview
);

/**
 * @route   POST /api/v1/reviews/:reviewId/helpful
 * @desc    Mark review as helpful or unhelpful
 * @access  Public
 * @body    {boolean} helpful - True for helpful, false for unhelpful (default: true)
 */
router.post("/reviews/:reviewId/helpful", markHelpful);

// ============================================================
// PUT ROUTES (Private - Authentication Required)
// ============================================================

/**
 * @route   PUT /api/v1/reviews/:reviewId
 * @desc    Update a review (owner only)
 * @access  Private (Auth required - review owner)
 * @body    {number} rating - New rating 1-5 (optional)
 * @body    {string} title - New title (optional)
 * @body    {string} comment - New comment (optional)
 */
router.put("/reviews/:reviewId", authMiddleware, updateReview);

// ============================================================
// DELETE ROUTES (Private - Authentication Required)
// ============================================================

/**
 * @route   DELETE /api/v1/reviews/:reviewId
 * @desc    Delete a review (owner or admin)
 * @access  Private (Auth required - review owner or admin)
 */
router.delete("/reviews/:reviewId", authMiddleware, deleteReview);

// ============================================================
// ERROR HANDLING
// ============================================================

// If no route matches
router.all("*", (req, res) => {
  res.status(404).json({
    success: false,
    message: "Review endpoint not found",
  });
});

module.exports = router;
