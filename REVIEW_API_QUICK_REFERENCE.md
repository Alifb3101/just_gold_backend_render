# Review API - Quick Reference

**Base URL:** `https://just-gold-backend-render.onrender.com/api/v1`

---

## 📋 Quick Endpoints

### Get Reviews (No Auth)
```bash
GET /products/:productId/reviews?page=1&limit=10&sortBy=recent
```
**Response:** Array of reviews + stats + pagination

### Create Review (Auth Required)
```bash
POST /products/:productId/reviews
Content-Type: multipart/form-data
Authorization: Bearer <token>

rating=5
title=Great Product
comment=Works perfectly
images=photo.jpg (optional)
```
**Response:** Created review object

### Get Single Review (No Auth)
```bash
GET /reviews/:reviewId
```
**Response:** Single review with all images

### Update Review (Auth - Owner Only)
```bash
PUT /reviews/:reviewId
Authorization: Bearer <token>
Content-Type: application/json

{"rating": 4, "title": "Updated", "comment": "..."}
```

### Delete Review (Auth - Owner/Admin)
```bash
DELETE /reviews/:reviewId
Authorization: Bearer <token>
```

### Mark Helpful (No Auth)
```bash
POST /reviews/:reviewId/helpful
Content-Type: application/json

{"helpful": true}
```

---

## ✅ Validation Rules

| Field | Required | Rules |
|-------|----------|-------|
| rating | Yes | Integer 1-5 |
| title | Yes | 1-255 characters |
| comment | No | Max 2000 characters |
| images | No | Max 5 files, JPEG/PNG/GIF/WebP |

---

## 🔑 Auth Headers

```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

Get token:
```bash
POST /auth/login
{"email": "user@example.com", "password": "password123"}
# Returns: accessToken
```

---

## 📊 Response Format

### Success (200/201)
```json
{
  "success": true,
  "data": { ... },
  "message": "Operation successful"
}
```

### Error (4xx/5xx)
```json
{
  "success": false,
  "error": "Error message",
  "code": "ERROR_CODE"
}
```

---

## 🎯 Common Tasks

### Display Product Reviews (Frontend)
```javascript
// Fetch reviews
const response = await fetch(
  `https://api.justgold.com/api/v1/products/${productId}/reviews?sortBy=helpful`
);
const { data } = await response.json();
const { reviews, stats } = data;

// Show rating: stats.averageRating
// Show count: stats.totalReviews
// Show distribution: stats.distribution
```

### Submit Review with Images (Frontend)
```javascript
const formData = new FormData();
formData.append('rating', 5);
formData.append('title', 'Great product!');
formData.append('comment', 'Highly recommended');
formData.append('images', file1);
formData.append('images', file2);

const response = await fetch(
  `https://api.justgold.com/api/v1/products/${productId}/reviews`,
  {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
    body: formData
  }
);
```

### Get Verified Purchased Badge (Frontend)
```javascript
// In review object:
if (review.verifiedPurchase) {
  // Show "✓ Verified Purchase" badge
}
```

---

## ⚠️ Common Errors

| Error | Meaning | Fix |
|-------|---------|-----|
| `DUPLICATE_REVIEW` | Already reviewed | Show existing review or update |
| `PRODUCT_NOT_FOUND` | Bad product ID | Check product exists |
| `UNAUTHORIZED` | Can't edit | Only owner can edit |
| `INVALID_RATING` | Rating not 1-5 | Validate rating value |
| `TITLE_TOO_LONG` | Title too long | Max 255 chars |

---

## 🚀 Sort Options

```
sortBy=recent          # Newest first
sortBy=helpful         # Most helpful first
sortBy=rating-high     # 5 stars first
sortBy=rating-low      # 1 star first
```

---

## 📞 Support

For detailed API docs: `REVIEW_API_DOCUMENTATION.md`  
For implementation details: `REVIEW_IMPLEMENTATION_SUMMARY.md`

**Production API:** https://just-gold-backend-render.onrender.com
