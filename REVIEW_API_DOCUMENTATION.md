# Review API Documentation

**Database**: PostgreSQL with image support via Cloudinary  
**Status**: Production Ready  
**Version**: 1.0  
**Authentication**: JWT Bearer Token for write operations  

---

## 📋 Table of Contents

1. [Overview](#overview)
2. [Database Schema](#database-schema)
3. [API Endpoints](#api-endpoints)
4. [Authentication](#authentication)
5. [Image Handling](#image-handling)
6. [Error Codes](#error-codes)
7. [Examples](#examples)
8. [Best Practices](#best-practices)

---

## Overview

The Review API provides a complete system for users to review products with:

- ⭐ **Star Ratings** (1-5)
- 💬 **Text Reviews** (optional)
- 🖼️ **Optional Images** (up to 5 per review, stored in Cloudinary)
- ✅ **Verified Purchase Badge** (automatic detection)
- 👍 **Helpful/Unhelpful Counter**
- 📊 **Review Statistics & Aggregation**
- 🔄 **Pagination & Sorting**

### Features

| Feature | Details |
|---------|---------|
| **One review per user per product** | Prevents duplicate reviews |
| **Verified purchase badge** | Auto-detected from order history |
| **Image storage** | Cloudinary integration (optional) |
| **Caching** | Redis cache for product reviews |
| **Sorting options** | Recent, Helpful, Rating (high/low) |
| **Aggregated stats** | Total, average rating, distribution |

---

## Database Schema

### Reviews Table

```sql
CREATE TABLE reviews (
  id SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  rating INTEGER (1-5), -- Required
  title VARCHAR(255), -- Required
  comment TEXT, -- Optional
  helpful_count INTEGER DEFAULT 0,
  unhelpful_count INTEGER DEFAULT 0,
  verified_purchase BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(product_id, user_id)
);
```

### Review Images Table

```sql
CREATE TABLE review_images (
  id SERIAL PRIMARY KEY,
  review_id INTEGER NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  image_key VARCHAR(255), -- Cloudinary key
  image_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);
```

---

## API Endpoints

### 1️⃣ GET Product Reviews

**Endpoint:** `GET /api/v1/products/:productId/reviews`  
**Authentication:** Not required  
**Rate Limit:** Standard  

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | number | 1 | Page number (starts at 1) |
| `limit` | number | 10 | Items per page (max: 100) |
| `sortBy` | string | recent | Sort option: `recent`, `helpful`, `rating-high`, `rating-low` |

**Response (200 OK):**

```json
{
  "success": true,
  "data": {
    "reviews": [
      {
        "id": 1,
        "productId": 5,
        "userId": 10,
        "rating": 5,
        "title": "Best product!",
        "comment": "High quality and fast delivery",
        "helpfulCount": 25,
        "unhelpfulCount": 2,
        "verifiedPurchase": true,
        "images": [
          {
            "id": 1,
            "image_key": "reviews/product_5_review_1_image_1.jpg",
            "image_url": "https://res.cloudinary.com/dvagrhc2w/image/upload/reviews/..."
          }
        ],
        "userName": "Alifb3101",
        "createdAt": "2024-03-10T14:30:00Z",
        "updatedAt": "2024-03-10T14:30:00Z"
      }
    ],
    "stats": {
      "totalReviews": 150,
      "averageRating": 4.5,
      "distribution": {
        "fiveStar": 120,
        "fourStar": 20,
        "threeStar": 8,
        "twoStar": 2,
        "oneStar": 0
      }
    },
    "pagination": {
      "page": 1,
      "limit": 10,
      "total": 150,
      "pages": 15
    }
  },
  "message": "Reviews retrieved successfully"
}
```

**Example Request:**

```bash
curl -X GET "https://just-gold-backend-render.onrender.com/api/v1/products/5/reviews?page=1&limit=10&sortBy=helpful"
```

---

### 2️⃣ GET Single Review

**Endpoint:** `GET /api/v1/reviews/:reviewId`  
**Authentication:** Not required  

**Response (200 OK):**

```json
{
  "success": true,
  "data": {
    "id": 1,
    "productId": 5,
    "userId": 10,
    "rating": 5,
    "title": "Best product!",
    "comment": "High quality and fast delivery",
    "helpfulCount": 25,
    "unhelpfulCount": 2,
    "verifiedPurchase": true,
    "images": [
      {
        "id": 1,
        "image_key": "reviews/product_5_review_1_image_1.jpg",
        "image_url": "https://res.cloudinary.com/..."
      },
      {
        "id": 2,
        "image_key": "reviews/product_5_review_1_image_2.jpg",
        "image_url": "https://res.cloudinary.com/..."
      }
    ],
    "userName": "Alifb3101",
    "createdAt": "2024-03-10T14:30:00Z",
    "updatedAt": "2024-03-10T14:30:00Z"
  },
  "message": "Review retrieved successfully"
}
```

**Example:**

```bash
curl -X GET "https://just-gold-backend-render.onrender.com/api/v1/reviews/1"
```

---

### 3️⃣ CREATE Review (POST)

**Endpoint:** `POST /api/v1/products/:productId/reviews`  
**Authentication:** Required (Bearer Token)  
**Content-Type:** `multipart/form-data`  

**Request Headers:**

```
Authorization: Bearer <jwt_token>
Content-Type: multipart/form-data
```

**Body Parameters:**

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `rating` | number | ✅ Yes | 1-5 (integer) |
| `title` | string | ✅ Yes | 1-255 characters |
| `comment` | string | ❌ No | Max 2000 characters |
| `images` | file[] | ❌ No | Max 5 files, up to 100MB each |

**Accepted Image Formats:** JPEG, PNG, GIF, WebP

**Response (201 Created):**

```json
{
  "success": true,
  "data": {
    "id": 125,
    "productId": 5,
    "userId": 10,
    "rating": 5,
    "title": "Excellent quality",
    "comment": "Perfect for my needs",
    "helpfulCount": 0,
    "unhelpfulCount": 0,
    "verifiedPurchase": true,
    "images": [
      {
        "id": 1,
        "image_key": "reviews/product_5_review_125_image_0.jpg",
        "image_url": "https://res.cloudinary.com/..."
      }
    ],
    "userName": "Alifb3101",
    "createdAt": "2024-03-15T10:30:00Z"
  },
  "message": "Review created successfully"
}
```

**Example (with images):**

```bash
curl -X POST "https://just-gold-backend-render.onrender.com/api/v1/products/5/reviews" \
  -H "Authorization: Bearer your_jwt_token" \
  -F "rating=5" \
  -F "title=Excellent quality" \
  -F "comment=Perfect product for the price" \
  -F "images=@/path/to/image1.jpg" \
  -F "images=@/path/to/image2.jpg"
```

**Example (without images):**

```bash
curl -X POST "https://just-gold-backend-render.onrender.com/api/v1/products/5/reviews" \
  -H "Authorization: Bearer your_jwt_token" \
  -H "Content-Type: application/json" \
  -d '{
    "rating": 4,
    "title": "Good product",
    "comment": "Meets expectations"
  }'
```

**Error Responses:**

```json
// 400 - Duplicate review
{
  "success": false,
  "error": "You have already reviewed this product",
  "code": "DUPLICATE_REVIEW"
}

// 404 - Product not found
{
  "success": false,
  "error": "Product not found",
  "code": "PRODUCT_NOT_FOUND"
}

// 401 - Unauthorized
{
  "success": false,
  "error": "Unauthorized",
  "code": "UNAUTHORIZED"
}
```

---

### 4️⃣ UPDATE Review (PUT)

**Endpoint:** `PUT /api/v1/reviews/:reviewId`  
**Authentication:** Required (Bearer Token - owner only)  
**Content-Type:** `application/json`  

**Body Parameters (all optional, send only fields to update):**

```json
{
  "rating": 4,
  "title": "Updated title",
  "comment": "Updated comment"
}
```

**Response (200 OK):**

```json
{
  "success": true,
  "data": {
    "id": 1,
    "product_id": 5,
    "user_id": 10,
    "rating": 4,
    "title": "Updated title",
    "comment": "Updated comment",
    "helpful_count": 25,
    "unhelpful_count": 2,
    "verified_purchase": true,
    "created_at": "2024-03-10T14:30:00Z",
    "updated_at": "2024-03-15T11:45:00Z"
  },
  "message": "Review updated successfully"
}
```

**Example:**

```bash
curl -X PUT "https://just-gold-backend-render.onrender.com/api/v1/reviews/1" \
  -H "Authorization: Bearer your_jwt_token" \
  -H "Content-Type: application/json" \
  -d '{
    "rating": 4,
    "title": "Updated: Still good but...",
    "comment": "After using for 2 weeks..."
  }'
```

---

### 5️⃣ DELETE Review

**Endpoint:** `DELETE /api/v1/reviews/:reviewId`  
**Authentication:** Required (Bearer Token - owner or admin)  

**Response (200 OK):**

```json
{
  "success": true,
  "message": "Review deleted successfully"
}
```

**Example:**

```bash
curl -X DELETE "https://just-gold-backend-render.onrender.com/api/v1/reviews/1" \
  -H "Authorization: Bearer your_jwt_token"
```

---

### 6️⃣ Mark Review as Helpful

**Endpoint:** `POST /api/v1/reviews/:reviewId/helpful`  
**Authentication:** Not required  

**Body Parameters:**

```json
{
  "helpful": true  // true for helpful, false for unhelpful
}
```

**Response (200 OK):**

```json
{
  "success": true,
  "data": {
    "id": 1,
    "helpful_count": 26,
    "unhelpful_count": 2
  },
  "message": "Review marked as helpful"
}
```

**Example:**

```bash
# Mark as helpful
curl -X POST "https://just-gold-backend-render.onrender.com/api/v1/reviews/1/helpful" \
  -H "Content-Type: application/json" \
  -d '{"helpful": true}'

# Mark as unhelpful
curl -X POST "https://just-gold-backend-render.onrender.com/api/v1/reviews/1/helpful" \
  -H "Content-Type: application/json" \
  -d '{"helpful": false}'
```

---

## Authentication

### JWT Token Format

All authenticated endpoints require a JWT Bearer token in the Authorization header:

```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### Get JWT Token

```bash
curl -X POST "https://just-gold-backend-render.onrender.com/api/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "password123"
  }'
```

Response includes `accessToken`:

```json
{
  "success": true,
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": { ... }
  }
}
```

---

## Image Handling

### Upload Requirements

- **Format**: JPEG, PNG, GIF, WebP
- **Max size**: 100MB per file
- **Max files per review**: 5
- **Storage**: Cloudinary (automatic)
- **Optimization**: Automatic compression by Cloudinary

### Image URLs

Images are returned with full Cloudinary URLs:

```json
{
  "id": 1,
  "image_key": "reviews/product_5_review_1_image_1.jpg",
  "image_url": "https://res.cloudinary.com/dvagrhc2w/image/upload/reviews/product_5_review_1_image_1.jpg"
}
```

### Image Ordering

Images are automatically ordered by `image_order` field (0-indexed).

---

## Error Codes

### Client Errors (4xx)

| Code | HTTP | Error | Cause |
|------|------|-------|-------|
| `INVALID_RATING` | 400 | Rating must be 1-5 | Invalid rating value |
| `INVALID_PRODUCT_ID` | 400 | Invalid product ID | Missing/invalid productId |
| `MISSING_TITLE` | 400 | Title required | Empty title |
| `TITLE_TOO_LONG` | 400 | Title max 255 chars | Title exceeds limit |
| `COMMENT_TOO_LONG` | 400 | Comment max 2000 chars | Comment exceeds limit |
| `NO_UPDATES` | 400 | No fields to update | PUT with no fields |
| `DUPLICATE_REVIEW` | 409 | Already reviewed | User already reviewed this product |
| `PRODUCT_NOT_FOUND` | 404 | Product not found | Product doesn't exist |
| `REVIEW_NOT_FOUND` | 404 | Review not found | Review ID doesn't exist |
| `UNAUTHORIZED` | 403 | Not authorized | Can't modify other's review |
| `INVALID_TOKEN` | 401 | Invalid token | Bad/expired JWT |

### Server Errors (5xx)

| Code | HTTP | Error | Cause |
|------|------|-------|-------|
| `DB_ERROR` | 500 | Database error | Query failed |
| `UPLOAD_ERROR` | 500 | Upload failed | Cloudinary error |

---

## Examples

### Complete Review Flow

#### 1. User logs in

```bash
curl -X POST "https://just-gold-backend-render.onrender.com/api/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "password123"
  }'
```

Save the `accessToken` from response.

#### 2. User submits review with images

```bash
curl -X POST "https://just-gold-backend-render.onrender.com/api/v1/products/5/reviews" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -F "rating=5" \
  -F "title=Amazing quality!" \
  -F "comment=Better than expected. Great durability and design. Highly recommend!" \
  -F "images=@product_photo_1.jpg" \
  -F "images=@product_photo_2.jpg" \
  -F "images=@product_photo_3.jpg"
```

#### 3. Other users view reviews

```bash
curl -X GET "https://just-gold-backend-render.onrender.com/api/v1/products/5/reviews?sortBy=helpful&limit=5"
```

#### 4. User marks helpful

```bash
curl -X POST "https://just-gold-backend-render.onrender.com/api/v1/reviews/123/helpful" \
  -H "Content-Type: application/json" \
  -d '{"helpful": true}'
```

#### 5. User updates their review

```bash
curl -X PUT "https://just-gold-backend-render.onrender.com/api/v1/reviews/123" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Still amazing after 2 months!",
    "comment": "After using for 2 months, it still works perfectly..."
  }'
```

#### 6. User deletes review

```bash
curl -X DELETE "https://just-gold-backend-render.onrender.com/api/v1/reviews/123" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

---

## Best Practices

### For Frontend Developers

1. **Image Prerequisites**
   - Validate images before upload (format, size)
   - Show upload progress to users
   - Resize/compress large images client-side if needed

2. **Review Display**
   - Cache review stats locally (invalidate after new review)
   - Paginate long review lists (don't load all at once)
   - Show verified purchase badge alongside reviews

3. **Error Handling**
   - Handle duplicate review gracefully (show existing review)
   - Show validation errors to user
   - Retry failed uploads with exponential backoff

4. **Performance**
   - Load reviews on-demand (lazy load)
   - Cache product stats API response
   - Preload images using `<link rel="preload">`

### For Database/DevOps

1. **Indexing**
   - Reviews are indexed on product_id, user_id, rating, created_at
   - Performance: O(500ms) for first page, O(50ms) cached

2. **Scalability**
   - Reviews are paginated (10 items default)
   - Redis caches product review stats
   - Images stored in Cloudinary (not database)

3. **Maintenance**
   - Monitor review count per product (alert if > 10k)
   - Prune old/spam reviews monthly
   - Verify purchase badge accuracy from orders table

### For QA/Testing

1. **Integration Tests**

```bash
# Test 1: Create review as verified buyer
API_TOKEN=$(get_login_token)
curl -X POST "/products/5/reviews" \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"rating": 5, "title": "Test", "comment": "Test review"}'

# Test 2: Try duplicate review (should fail)
curl -X POST "/products/5/reviews" \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"rating": 4, "title": "Second review", "comment": ""}'
# Expected: 409 DUPLICATE_REVIEW

# Test 3: Get reviews with pagination
curl -X GET "/products/5/reviews?page=1&limit=10&sortBy=helpful"

# Test 4: Mark as helpful
curl -X POST "/reviews/1/helpful" \
  -H "Content-Type: application/json" \
  -d '{"helpful": true}'
```

2. **Load Test**

```bash
# Simulate 100 concurrent review views
ab -n 1000 -c 100 https://just-gold-backend-render.onrender.com/api/v1/products/5/reviews
```

Expected: 200+ RPS, < 500ms response time

---

## Migration Guide

### From No Reviews to Reviews API

1. **Create database schema**
   ```bash
   psql $DATABASE_URL -f scripts/reviews_schema.sql
   ```

2. **Deploy backend code**
   - Push code to main branch
   - Wait for Render to auto-deploy

3. **Test endpoints**
   ```bash
   # Health check
   curl https://just-gold-backend-render.onrender.com/

   # Test review creation
   curl -X POST /api/v1/products/1/reviews ...
   ```

4. **Notify frontend team**
   - Document endpoints in Postman
   - Share this guide with frontend developers

---

**Status**: ✅ Production Ready  
**Last Updated**: 2024-03-15  
**Maintainer**: Backend Team
