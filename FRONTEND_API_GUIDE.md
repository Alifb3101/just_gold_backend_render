# 🌐 Frontend API Guide (For AI Agents)

> **Goal:** Consume the Backend_Just_gold API with maximum performance, clarity, and zero guesswork.

---

## 1. 🔗 Base Configuration

| Setting            | Value                                | Notes |
|--------------------|--------------------------------------|-------|
| API Base URL       | `http://localhost:5000/api/v1`       | Use environment variable in production. |
| Auth Header        | `Authorization: Bearer <token>`      | Required for protected routes (e.g., orders). |
| Content-Type (POST)| `multipart/form-data` (for uploads)  | JSON for non-file requests. |
| Response Format    | JSON                                 | UTF-8 encoded. |

---

## 2. 📚 Endpoint Summary

### Products
| Method | Endpoint                      | Description |
|--------|-------------------------------|-------------|
| GET    | `/products?page=1`            | Paginated product catalog (12 per page). |
| GET    | `/products/:slug`             | Full product detail with variants + media. |
| POST   | `/products`                   | Admin-only product creation (multipart). |
| DELETE | `/products/:id`               | Admin-only product removal. |

### Categories
| Method | Endpoint             | Description |
|--------|----------------------|-------------|
| GET    | `/categories`        | Full category tree (parent + children). |
| GET    | `/categories/:id`    | Single category detail (if implemented). |

### Auth
| Method | Endpoint         | Description |
|--------|------------------|-------------|
| POST   | `/auth/register` | Create user account and receive role + id. |
| POST   | `/auth/login`    | Obtain JWT (7d expiry) for subsequent calls. |

### Orders (protected)
| Method | Endpoint      | Description |
|--------|---------------|-------------|
| GET    | `/orders`     | List orders for authenticated user. |
| POST   | `/orders`     | Create order from cart payload. |

> **JWT Handling:** Token is returned from `/auth/login` and must be sent as `Authorization: Bearer <token>`. Token payload contains `id` and `role` only. No refresh endpoint yet; implement silent re-login before expiry.

> **Tip:** Cache `/categories` aggressively—it rarely changes.

---

## 3. 🧠 Data Model Cheat Sheet

### Product List (`GET /products`)
```json
[
  {
    "id": 12,
    "name": "Radiant Glow Serum",
    "slug": "radiant-glow-serum",
    "base_price": "2499.00",
    "description": "Short description...",
    "product_model_no": "SER-2026-001",
    "created_at": "2026-02-08T10:00:00.000Z"
  }
]
```

### Product Detail (`GET /products/:slug`)
```json
{
  "id": 12,
  "name": "Radiant Glow Serum",
  "description": "Full description",
  "base_price": "2499.00",
  "how_to_apply": "Apply...",
  "benefits": "Brightens",
  "product_description": "Vitamin C",
  "ingredients": "Vitamin C, HA",
  "variants": [
    {
      "id": 101,
      "shade": "30ml",
      "stock": 50,
      "main_image": "https://res.cloudinary.com/.../variants/abc.jpg",
      "price": "2499.00",
      "discount_price": "1999.00",
      "variant_model_no": "SER-001-30"
    }
  ],
  "media": [
    {
      "image_url": "https://res.cloudinary.com/.../images/gallery1.jpg",
      "media_type": "image"
    },
    {
      "image_url": "https://res.cloudinary.com/.../videos/demo.mp4",
      "media_type": "video"
    }
  ]
}
```

---

## 4. 🔐 Auth Flows (Signup & Login)

### POST /auth/register
- **Body:** `{ "name": string (2-80 chars), "email": string (valid email), "password": string (min 8 chars), "phone"?: string }`
- **Response 201:**
```json
{ "id": 42, "email": "jane@justgold.com", "role": "customer", "phone": "+1-555-1111" }
```
- **Error 400:** `{ "message": "Email already exists" }` (email uniqueness enforced at DB).
- **Notes:** Password is stored as bcrypt hash (12 rounds). No token is returned on register—login afterwards.

### POST /auth/login
- **Body:** `{ "email": string, "password": string }`
- **Response 200:**
```json
{ "token": "<jwt>" }
```
- **Error 401:** `{ "message": "Invalid credentials" }`
- **Token:** HS256 JWT, 7d expiry, payload `{ id, role }`.
- **Send with requests:** `Authorization: Bearer <token>` header for all protected endpoints.

### Client usage template (TypeScript)
```typescript
type LoginResponse = { token: string };

export async function login(email: string, password: string): Promise<LoginResponse> {
  return fetchJSON<LoginResponse>(`/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  });
}

export async function register(name: string, email: string, password: string) {
  return fetchJSON<{ id: number; email: string; role: string }>(`/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, email, password })
  });
}

// Attach token to protected calls
export function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}` };
}
```

---

## 5. 🖼️ Image Strategy (VERY IMPORTANT)

1. **Media images (`media` array)**
   - These are fixed gallery assets: hero shots, lifestyle images, product videos.
   - They **do not change** when a variant is switched.
   - Use them for main carousel or media gallery.

2. **Variant images (`variants[].main_image`)**
   - Each variant has its own Cloudinary URL.
   - Swap this image when users change shades/volume/etc.
   - If a variant lacks `main_image`, fallback to first media image.

3. **Cloudinary URLs**
   - Already optimized with `f_auto,q_auto`. Cache them.
   - Use transformation strings for thumbnails, e.g.
     `https://res.cloudinary.com/<cloud>/image/upload/w_400,h_400,c_fill/...`

4. **CDN Behavior**
   - Treat URLs as immutable—versioned by Cloudinary. Use long-term caching.

---

## 6. ⚡ Performance Playbook

1. **Batch Requests**
   - Fetch categories and first product page in parallel.
   - Example: `Promise.all([fetch('/categories'), fetch('/products?page=1')])`.

2. **Responsive Loading**
   - Use lazy loading for gallery images.
   - Prefetch variant images after first render to ensure instant switchover.

3. **Optimistic Variant Switching**
   - Pre-store Cloudinary URLs; no additional API call needed when switching variants.

4. **Pagination**
   - Server returns 12 products per page. Use `page` query param.
   - Implement “Load more” or infinite scroll by incrementing `page`.

5. **Error Handling**
   - API errors come with `{ message: string }`. Surface user-friendly toast/snackbar.
   - For form submissions, display `details` if provided.

---

## 7. 🧭 Flow Examples

### A. Home / Navigation
1. `GET /categories`
2. Build menu sections using parent categories.
3. Group subcategories under FACE, EYES, LIPS, TOOLS & BRUSHES.

### B. Category Page (e.g., FACE → Foundation)
1. Fetch `/products?page=N&category=foundation` (if filter endpoint exists) or filter client-side based on metadata.
2. Display gallery media.
3. Provide variant swatches using `variants` array.

### C. Product Detail Page
1. `GET /products/:slug`
2. Render gallery from `media` array.
3. Render variant selector from `variants` array.
4. On variant change, update price, stock badge, and image using `variant.main_image`.

---

## 8. 🧩 Request Templates

```typescript
// Example TypeScript helper
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000/api/v1";

export async function fetchJSON<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { 'Accept': 'application/json', ...(init?.headers || {}) },
    ...init,
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(error.message || `Request failed (${res.status})`);
  }
  return res.json();
}

// Usage
const products = await fetchJSON<Product[]>(`/products?page=1`);
const product = await fetchJSON<ProductDetail>(`/products/${slug}`);
```

---

## 9. 🛡️ Reliability & Fallbacks

- **Timeouts:** Abort fetches after 10 seconds to prevent hanging UI.
- **Retry Strategy:** For idempotent GETs, retry once on network failure.
- **Offline Mode:** Cache last product list locally for fallback experience.
- **Graceful Degradation:** If media fails to load, show placeholder + retry button.

---

## 10. ✅ Checklist for Frontend AI

- [ ] Use `/categories` to build navigation tree.
- [ ] Fetch `/products?page=1` on landing page.
- [ ] Use `variants[].main_image` for dynamic swatches.
- [ ] Handle `media_type === "video"` to render HTML5 video player.
- [ ] Cache Cloudinary URLs; no need to re-request.
- [ ] Show skeleton loaders while awaiting API responses.
- [ ] Log API errors with endpoint + payload for debugging.

---

## 11. 🧭 Need Something Else?

- Want filtering/sorting parameters? Ping backend team.
- Need GraphQL/SDK wrappers? Outline desired shape and we’ll provide it.

**Happy coding! Deliver buttery-smooth storefronts.** ✨
