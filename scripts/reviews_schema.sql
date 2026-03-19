-- ============================================================
-- REVIEWS TABLE SCHEMA
-- Comprehensive review system with images support
-- ============================================================

-- Drop existing table if needed (for migration purposes)
DROP TABLE IF EXISTS review_images CASCADE;
DROP TABLE IF EXISTS reviews CASCADE;

-- ============================================================
-- MAIN REVIEWS TABLE
-- ============================================================
CREATE TABLE reviews (
  id SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  -- Review Content
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  title VARCHAR(255) NOT NULL,
  comment TEXT,
  
  -- Metadata
  helpful_count INTEGER DEFAULT 0,
  unhelpful_count INTEGER DEFAULT 0,
  verified_purchase BOOLEAN DEFAULT FALSE,
  
  -- Timestamps
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  -- Uniqueness constraint - one review per user per product
  UNIQUE(product_id, user_id)
);

-- ============================================================
-- REVIEW IMAGES TABLE (Nullable images)
-- Store Cloudinary image keys for each review
-- ============================================================
CREATE TABLE review_images (
  id SERIAL PRIMARY KEY,
  review_id INTEGER NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  image_key VARCHAR(255) NOT NULL,  -- Cloudinary image key
  image_order INTEGER DEFAULT 0,     -- Order of images in review
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- INDEXES FOR COMMON QUERIES
-- ============================================================

-- Reviews table indexes
CREATE INDEX IF NOT EXISTS idx_reviews_product_id 
  ON reviews(product_id);

CREATE INDEX IF NOT EXISTS idx_reviews_user_id 
  ON reviews(user_id);

CREATE INDEX IF NOT EXISTS idx_reviews_product_rating 
  ON reviews(product_id, rating);

CREATE INDEX IF NOT EXISTS idx_reviews_user_created 
  ON reviews(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_reviews_product_recent 
  ON reviews(product_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_reviews_product_rating_created 
  ON reviews(product_id, rating DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_reviews_verified_purchase 
  ON reviews(verified_purchase);

-- Review images table indexes
CREATE INDEX IF NOT EXISTS idx_review_images_review_id 
  ON review_images(review_id);

CREATE INDEX IF NOT EXISTS idx_review_images_order 
  ON review_images(image_order);

-- ============================================================
-- VIEWS FOR AGGREGATED DATA
-- ============================================================

-- Product review statistics
CREATE OR REPLACE VIEW product_review_stats AS
SELECT 
  p.id as product_id,
  COUNT(r.id) as total_reviews,
  ROUND(AVG(r.rating)::NUMERIC, 2) as average_rating,
  COUNT(CASE WHEN r.rating = 5 THEN 1 END) as five_star,
  COUNT(CASE WHEN r.rating = 4 THEN 1 END) as four_star,
  COUNT(CASE WHEN r.rating = 3 THEN 1 END) as three_star,
  COUNT(CASE WHEN r.rating = 2 THEN 1 END) as two_star,
  COUNT(CASE WHEN r.rating = 1 THEN 1 END) as one_star,
  COUNT(CASE WHEN r.verified_purchase = true THEN 1 END) as verified_count,
  MAX(r.created_at) as last_review_date
FROM products p
LEFT JOIN reviews r ON p.id = r.product_id
GROUP BY p.id;

-- ============================================================
-- TRIGGERS FOR TIMESTAMP MANAGEMENT
-- ============================================================

-- Create update_timestamp function if it doesn't exist
CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for reviews table
DROP TRIGGER IF EXISTS update_reviews_timestamp ON reviews;

CREATE TRIGGER update_reviews_timestamp
BEFORE UPDATE ON reviews
FOR EACH ROW
EXECUTE FUNCTION update_timestamp();
