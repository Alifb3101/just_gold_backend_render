# IMAGE UPLOAD DEBUGGING GUIDE

## Problem: Image uploaded but not showing up

Follow these steps to debug:

---

## Step 1: Check Browser Console

Open DevTools (F12) → Console tab

Look for logs:
```javascript
[UPLOAD DEBUG] Request received
[UPLOAD DEBUG] Processing files
[UPLOAD SUCCESS] Image uploaded
```

If you DON'T see these → upload didn't reach backend.

---

## Step 2: Check Network Tab

Open DevTools → Network tab

Upload image and look for:
```
POST /api/v1/products/{id}/upload
```

Check Response:
```json
{
  "success": true,
  "message": "Product created/updated successfully",
  "product": {
    "thumbnail": "https://ik.imagekit.io/...",
    "thumbnail_key": "just_gold/products/abc.jpg",
    "media_provider": "imagekit"
  }
}
```

**If missing thumbnail_key or media_provider → Database issue**

---

## Step 3: Check Backend Logs

If running locally, check server logs:

```
[UPLOAD DEBUG] Request received
[UPLOAD DEBUG] Processing files: [thumbnail]
[UPLOAD DEBUG] File thumbnail/abc.jpg processing...
[UPLOAD SUCCESS] Cloudinary upload result:
  - secure_url: https://res.cloudinary.com/...
  - public_id: just_gold/products/abc.jpg

[DATABASE] Updating product:
  - thumbnail_key: just_gold/products/abc.jpg
  - media_provider: imagekit
  - thumbnail: https://res.cloudinary.com/...
```

---

## Step 4: Check Database Directly

Run this query:

```sql
SELECT 
  id,
  name,
  thumbnail,
  thumbnail_key,
  media_provider,
  created_at
FROM products
WHERE id = {your_product_id}
ORDER BY created_at DESC
LIMIT 1;
```

What you should see:

```
| id | name | thumbnail | thumbnail_key | media_provider |
|----|------|-----------|--------------|---|
| 1 | Gold Ring | https://res.cloud... | just_gold/products/abc.jpg | imagekit |
```

**If thumbnail_key is NULL → Upload succeeded but not saved to DB**

---

## Step 5: Verify ImageKit URL Works

If you have `thumbnail_key`, construct ImageKit URL:

```javascript
const thumbnailUrl = `https://ik.imagekit.io/dvagrhc2w/${thumbnailKey}?tr=w-300,q-80`;
console.log("ImageKit URL:", thumbnailUrl);
// Should be: https://ik.imagekit.io/dvagrhc2w/just_gold/products/abc.jpg?tr=w-300,q-80
```

Open URL in browser → Should show image.

If 404 → S3 upload failed.

---

## Common Issues

### Issue 1: No logs at all

```
❌ Upload request never reached backend
```

**Fix:**
- Check browser console for fetch errors
- Verify token is valid (login first)
- Check Authorization header is sent

### Issue 2: Logs show success but image not in DB

```
[UPLOAD SUCCESS] Image uploaded
But: thumbnail_key = NULL in database
```

**Fix:**
- Product creation failed after upload
- Check name, base_price, category_id are sent
- Check server logs for SQL errors

### Issue 3: URL works but image 404

```
ImageKit URL returns 404
```

**Fix:**
- S3 upload failed
- Check AWS credentials in .env
- Check S3 bucket permissions

---

## DEBUG CHECKLIST

```
✓ Browser console shows [UPLOAD DEBUG] logs?
✓ Network tab shows 200 response with thumbnail_key?
✓ Database shows thumbnail_key NOT NULL?
✓ ImageKit URL (ik.imagekit.io) returns image, not 404?
✓ media_provider column exists in database?

If ALL ✓ → Image should display!
If ANY ✗ → Check steps above
```

---

## Quick Test: Upload via curl

```bash
# 1. Get token
TOKEN=$(curl -s -X POST http://localhost:5000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@goldenegg.com","password":"password"}' \
  | jq -r '.token')

echo "Token: $TOKEN"

# 2. Create product first
PRODUCT_ID=$(curl -s -X POST http://localhost:5000/api/v1/product \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name":"Test Product",
    "base_price":999,
    "category_id":1
  }' | jq -r '.product.id')

echo "Product ID: $PRODUCT_ID"

# 3. Upload image
curl -X POST http://localhost:5000/api/v1/products/$PRODUCT_ID/upload \
  -H "Authorization: Bearer $TOKEN" \
  -F "thumbnail=@/path/to/image.jpg"
```

---

## Final Debugging: Database Query

```sql
-- Check all image-related fields
SELECT 
  id, 
  name, 
  thumbnail,
  thumbnail_key,
  media_provider,
  updated_at
FROM products
WHERE id = {product_id};

-- Check if media_provider column exists
DESCRIBE products; -- or \d products in psql
```

If `media_provider` column missing → Run migration:
```sql
ALTER TABLE products ADD COLUMN media_provider VARCHAR(50) DEFAULT 'imagekit';
```

---

**Still stuck?** Check browser console + backend logs + database in order. One of these will show the real error.
