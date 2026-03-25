# Image Upload Implementation Guide for Admin Panel

## ADMIN AI: Image Upload Instructions

When admin uploads product images, follow this EXACTLY:

---

## Step 1: Get Admin Token

```bash
curl -X POST http://localhost:5000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@goldenegg.com","password":"password"}'
```

Response: Get `token` from response.

---

## Step 2: Prepare Image File

```javascript
// JavaScript/React
const file = inputElement.files[0];  // User selects image
const formData = new FormData();
formData.append('image', file);
```

---

## Step 3: Send to Backend

```javascript
const token = localStorage.getItem('adminToken');

fetch('http://localhost:5000/api/v1/products/{productId}/upload', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`
    // DON'T set Content-Type - browser will set it for FormData
  },
  body: formData
})
.then(res => res.json())
.then(data => {
  console.log('Upload success:', data);
  // data contains: { image_key, media_provider, image_url }
})
.catch(err => console.error('Upload failed:', err));
```

---

## Step 4: Backend Handles Everything

✅ Receives image  
✅ Uploads to S3 via ImageKit SDK  
✅ Returns ImageKit CDN URL  
✅ Stores media_provider = 'imagekit' in database  
✅ Auto-generates 3 sizes (thumbnail, product, zoom)  

**You don't need to do anything else.**

---

## Key Points

| What | Action |
|------|--------|
| Get token? | Login with credentials first |
| Send image? | Use FormData, POST to /products/{id}/upload |
| Set Content-Type? | NO - browser does it automatically |
| Provider selection? | DON'T - backend auto-detects |
| Image sizes? | Automatic - no upload needed |

---

## Error Handling

```javascript
if (response.status === 401) {
  // Token expired, redirect to login
  window.location.href = '/login';
}

if (!response.ok) {
  // Log backend error
  console.error('Upload failed:', await response.json());
}
```

---

## Production URL

```javascript
// Development:
'http://localhost:5000/api/v1/products/{id}/upload'

// Production:
'https://just-gold-backend-render.onrender.com/api/v1/products/{id}/upload'
```

---

## That's It

Admin uploads → Frontend sends to backend → Backend handles S3/ImageKit → Done ✓
