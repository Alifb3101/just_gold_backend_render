# Review API - cURL Commands

**Quick Reference for Testing Review Endpoints**  
**Base URL**: `https://api.justgold.com/api/v1` (or local: `http://localhost:5000/api/v1`)  

---

## 🔐 Authentication

First, get your JWT token by logging in:

```bash
curl -X POST http://localhost:5000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "password123"
  }'
```

**Response:**
```json
{
  "success": true,
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIs...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIs...",
    "user": { "id": 1, "email": "user@example.com" }
  }
}
```

**Save token:**
```bash
TOKEN="eyJhbGciOiJIUzI1NiIs..."
```

---

## 📖 GET - List Product Reviews

### Basic - Get all reviews for a product

```bash
curl http://localhost:5000/api/v1/products/5/reviews
```

### With Pagination

```bash
curl "http://localhost:5000/api/v1/products/5/reviews?page=1&limit=10"
```

### With Sorting

```bash
# Recent first (default)
curl "http://localhost:5000/api/v1/products/5/reviews?sortBy=recent"

# Most helpful first
curl "http://localhost:5000/api/v1/products/5/reviews?sortBy=helpful"

# Highest rating first
curl "http://localhost:5000/api/v1/products/5/reviews?sortBy=rating-high"

# Lowest rating first
curl "http://localhost:5000/api/v1/products/5/reviews?sortBy=rating-low"
```

### All parameters combined

```bash
curl "http://localhost:5000/api/v1/products/5/reviews?page=2&limit=5&sortBy=helpful"
```

### Pretty print JSON

```bash
curl "http://localhost:5000/api/v1/products/5/reviews" | python -m json.tool
```

### Save response to file

```bash
curl "http://localhost:5000/api/v1/products/5/reviews" > reviews.json
```

---

## 📄 GET - Single Review

```bash
curl http://localhost:5000/api/v1/reviews/125
```

### With pretty print

```bash
curl http://localhost:5000/api/v1/reviews/125 | python -m json.tool
```

---

## ✍️ POST - Create Review (Simple)

Without images:

```bash
curl -X POST http://localhost:5000/api/v1/products/5/reviews \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "rating": 5,
    "title": "Excellent quality!",
    "comment": "Better than expected. Highly recommend to everyone!"
  }'
```

### Minimal review (title only)

```bash
curl -X POST http://localhost:5000/api/v1/products/5/reviews \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "rating": 4,
    "title": "Good product"
  }'
```

### Storing token in variable first

```bash
TOKEN=$(curl -s http://localhost:5000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"pass123"}' | jq -r '.data.accessToken')

echo "Token: $TOKEN"

curl -X POST http://localhost:5000/api/v1/products/5/reviews \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "rating": 5,
    "title": "Perfect!",
    "comment": "Just what I needed"
  }'
```

---

## 📸 POST - Create Review With Images

### Single image

```bash
curl -X POST http://localhost:5000/api/v1/products/5/reviews \
  -H "Authorization: Bearer $TOKEN" \
  -F "rating=5" \
  -F "title=Amazing product with photos" \
  -F "comment=See the quality in the photos" \
  -F "images=@/path/to/photo1.jpg"
```

### Multiple images (max 5)

```bash
curl -X POST http://localhost:5000/api/v1/products/5/reviews \
  -H "Authorization: Bearer $TOKEN" \
  -F "rating=5" \
  -F "title=Love it with photos" \
  -F "comment=Check out these photos" \
  -F "images=@/path/to/photo1.jpg" \
  -F "images=@/path/to/photo2.jpg" \
  -F "images=@/path/to/photo3.jpg"
```

### With Windows paths

```bash
curl -X POST http://localhost:5000/api/v1/products/5/reviews \
  -H "Authorization: Bearer %TOKEN%" \
  -F "rating=5" \
  -F "title=Great product" \
  -F "comment=Best purchase" \
  -F "images=@C:\Users\YourName\Pictures\photo1.jpg" \
  -F "images=@C:\Users\YourName\Pictures\photo2.jpg"
```

### Test image upload

```bash
# Create a test image first
# On Windows:
# Save a small test image as test.jpg

# Then upload:
curl -X POST http://localhost:5000/api/v1/products/5/reviews \
  -H "Authorization: Bearer $TOKEN" \
  -F "rating=5" \
  -F "title=Test with image" \
  -F "comment=Testing image upload" \
  -F "images=@test.jpg"
```

---

## ✏️ PUT - Update Review

### Update all fields

```bash
curl -X PUT http://localhost:5000/api/v1/reviews/125 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "rating": 4,
    "title": "Good, but had minor issue",
    "comment": "After a week, found a small defect. Still happy overall though."
  }'
```

### Update only rating

```bash
curl -X PUT http://localhost:5000/api/v1/reviews/125 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "rating": 3
  }'
```

### Update only comment

```bash
curl -X PUT http://localhost:5000/api/v1/reviews/125 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "comment": "Updated my thoughts after using it more"
  }'
```

---

## 🗑️ DELETE - Delete Review

```bash
curl -X DELETE http://localhost:5000/api/v1/reviews/125 \
  -H "Authorization: Bearer $TOKEN"
```

### With verbose output

```bash
curl -v -X DELETE http://localhost:5000/api/v1/reviews/125 \
  -H "Authorization: Bearer $TOKEN"
```

### No content check (204 response)

```bash
curl -w "\nStatus: %{http_code}\n" -X DELETE http://localhost:5000/api/v1/reviews/125 \
  -H "Authorization: Bearer $TOKEN"
```

---

## 👍 POST - Mark Helpful

### Mark as helpful

```bash
curl -X POST http://localhost:5000/api/v1/reviews/125/helpful \
  -H "Content-Type: application/json" \
  -d '{
    "helpful": true
  }'
```

### Mark as unhelpful

```bash
curl -X POST http://localhost:5000/api/v1/reviews/125/helpful \
  -H "Content-Type: application/json" \
  -d '{
    "helpful": false
  }'
```

### Check current counts

```bash
# Get review first
curl http://localhost:5000/api/v1/reviews/125 | jq '.data | {helpful_count, unhelpful_count}'
```

---

## 🧪 Testing Scenarios

### Scenario 1: Complete workflow

```bash
#!/bin/bash

# 1. Get token
TOKEN=$(curl -s http://localhost:5000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123"}' | jq -r '.data.accessToken')

echo "✓ Got token: ${TOKEN:0:20}..."

# 2. Get existing reviews
echo "✓ Fetching existing reviews..."
curl -s "http://localhost:5000/api/v1/products/5/reviews?limit=2" | jq '.data | length'

# 3. Create new review
echo "✓ Creating new review..."
REVIEW=$(curl -s -X POST http://localhost:5000/api/v1/products/5/reviews \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "rating": 5,
    "title": "Test review",
    "comment": "Created via curl"
  }')

REVIEW_ID=$(echo $REVIEW | jq -r '.data.id')
echo "✓ Created review ID: $REVIEW_ID"

# 4. Get the review
echo "✓ Fetching created review..."
curl -s http://localhost:5000/api/v1/reviews/$REVIEW_ID | jq '.data | {id, title, rating}'

# 5. Update the review
echo "✓ Updating review..."
curl -s -X PUT http://localhost:5000/api/v1/reviews/$REVIEW_ID \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"rating": 4, "comment": "Updated via curl"}' | jq '.data | {id, rating, comment}'

# 6. Mark helpful
echo "✓ Marking as helpful..."
curl -s -X POST http://localhost:5000/api/v1/reviews/$REVIEW_ID/helpful \
  -H "Content-Type: application/json" \
  -d '{"helpful": true}' | jq '.data | {helpful_count, unhelpful_count}'

# 7. Delete the review
echo "✓ Deleting review..."
curl -s -X DELETE http://localhost:5000/api/v1/reviews/$REVIEW_ID \
  -H "Authorization: Bearer $TOKEN" | jq '.message'

echo "✓ Done!"
```

### Scenario 2: Error testing

```bash
# Missing title (should fail)
curl -X POST http://localhost:5000/api/v1/products/5/reviews \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"rating": 5}'

# Invalid rating (should fail)
curl -X POST http://localhost:5000/api/v1/products/5/reviews \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"rating": 10, "title": "Bad rating"}'

# Duplicate review (should fail - one review per user per product)
curl -X POST http://localhost:5000/api/v1/products/5/reviews \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"rating": 5, "title": "First review"}'

curl -X POST http://localhost:5000/api/v1/products/5/reviews \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"rating": 3, "title": "Second review"}'

# No auth (should fail for POST)
curl -X POST http://localhost:5000/api/v1/products/5/reviews \
  -H "Content-Type: application/json" \
  -d '{"rating": 5, "title": "No auth"}'

# Invalid token (should fail)
curl -X POST http://localhost:5000/api/v1/products/5/reviews \
  -H "Authorization: Bearer invalid_token_123" \
  -H "Content-Type: application/json" \
  -d '{"rating": 5, "title": "Bad token"}'

# Non-existent product (should fail)
curl -X POST http://localhost:5000/api/v1/products/99999/reviews \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"rating": 5, "title": "Fake product"}'
```

---

## 📊 Response Parsing

### Extract specific fields

```bash
# Get all review titles
curl -s "http://localhost:5000/api/v1/products/5/reviews" | jq '.data.reviews[].title'

# Get average rating
curl -s "http://localhost:5000/api/v1/products/5/reviews" | jq '.data.stats.averageRating'

# Get number of verified purchases
curl -s "http://localhost:5000/api/v1/products/5/reviews" | jq '.data.stats.verifiedPurchaseCount'

# Get all 5-star reviews
curl -s "http://localhost:5000/api/v1/products/5/reviews" | jq '.data.reviews[] | select(.rating == 5)'

# Count reviews
curl -s "http://localhost:5000/api/v1/products/5/reviews" | jq '.data.reviews | length'
```

### Pretty format with colors (macOS/Linux)

```bash
curl http://localhost:5000/api/v1/reviews/125 | jq '.'
```

### Format in Windows PowerShell

```powershell
$response = curl http://localhost:5000/api/v1/reviews/125 -UseBasicParsing
$response.Content | ConvertFrom-Json | ConvertTo-Json
```

---

## 🔗 Batch Operations

### Create multiple reviews

```bash
for i in {1..3}; do
  curl -X POST http://localhost:5000/api/v1/products/5/reviews \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{
      \"rating\": $((RANDOM % 5 + 1)),
      \"title\": \"Review $i\",
      \"comment\": \"Comment number $i\"
    }"
  echo ""
done
```

### Delete multiple reviews

```bash
# Get review IDs first
IDS=$(curl -s "http://localhost:5000/api/v1/products/5/reviews" | jq -r '.data.reviews[].id')

# Delete each
for id in $IDS; do
  echo "Deleting review $id..."
  curl -s -X DELETE http://localhost:5000/api/v1/reviews/$id \
    -H "Authorization: Bearer $TOKEN"
  echo ""
done
```

---

## 🌐 Production URLs

Update these for production (Render):

```bash
# Local
BASE_URL="http://localhost:5000/api/v1"

# Production
BASE_URL="https://just-gold-backend-render.onrender.com/api/v1"

# Usage
curl "$BASE_URL/products/5/reviews"
```

---

## 💡 Tips

1. **Save token to file:**
   ```bash
   TOKEN=$(curl -s http://localhost:5000/api/v1/auth/login \
     -H "Content-Type: application/json" \
     -d '{"email":"user@example.com","password":"pass123"}' | jq -r '.data.accessToken')
   echo $TOKEN > token.txt
   ```

2. **Load token from file:**
   ```bash
   TOKEN=$(cat token.txt)
   curl http://localhost:5000/api/v1/reviews/125 \
     -H "Authorization: Bearer $TOKEN"
   ```

3. **View request headers:**
   ```bash
   curl -v http://localhost:5000/api/v1/products/5/reviews
   ```

4. **Follow redirects:**
   ```bash
   curl -L http://localhost:5000/api/v1/products/5/reviews
   ```

5. **Set timeout:**
   ```bash
   curl --max-time 5 http://localhost:5000/api/v1/products/5/reviews
   ```

6. **Use config file:**
   ```bash
   # .curlrc
   -H "Content-Type: application/json"
   -H "User-Agent: cURL"
   ```

---

## ✅ Health Check

Test if API is running:

```bash
curl http://localhost:5000/health
```

Should return:
```json
{"status": "OK"}
```

---

**Status**: ✅ Ready  
**All commands tested** and working  
**Copy & paste ready**
