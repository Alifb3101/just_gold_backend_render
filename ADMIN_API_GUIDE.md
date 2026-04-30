# Just Gold Backend - Admin API Guide

Complete guide for all admin APIs with curl commands, request/response examples.

**Base URL:** `http://localhost:5000`  
**Authentication:** Bearer token required for all admin endpoints  
**Admin Role:** All admin endpoints require `role("admin")` middleware

---

## Table of Contents

1. [Authentication](#authentication)
2. [Products CRUD](#products-crud)
3. [Orders CRUD](#orders-crud)
4. [Categories](#categories)
5. [User Management](#user-management)
6. [Reviews Management](#reviews-management)
7. [Contact Queries](#contact-queries)
8. [Settings](#settings)

---

## Authentication

### Login (Get Admin Token)

**Endpoint:** `POST /api/v1/auth/login`

**Request:**
```bash
curl -X POST "http://localhost:5000/api/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@example.com",
    "password": "your_password"
  }'
```

**Response:**
```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": 1,
      "name": "Admin User",
      "email": "admin@example.com",
      "role": "admin"
    }
  }
}
```

**Use the token in subsequent requests:**
```bash
export ADMIN_TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

---

## Products CRUD

### 1. Create Product

**Endpoint:** `POST /api/v1/products`  
**Content-Type:** `multipart/form-data` (for image uploads) or `application/json` (no images)

**Request (with images):**
```bash
curl -X POST "http://localhost:5000/api/v1/products" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -F "name=Luxury Gold Necklace" \
  -F "description=Beautiful 24k gold necklace" \
  -F "base_price=599.99" \
  -F "base_stock=50" \
  -F "category_id=1" \
  -F "is_active=true" \
  -F "image=@/path/to/thumbnail.jpg" \
  -F "gallery=@/path/to/image1.jpg" \
  -F "gallery=@/path/to/image2.jpg"
```

**Request (JSON only - no images):**
```bash
curl -X POST "http://localhost:5000/api/v1/products" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Luxury Gold Necklace",
    "description": "Beautiful 24k gold necklace",
    "base_price": 599.99,
    "base_stock": 50,
    "category_id": 1,
    "is_active": true
  }'
```

**Response:**
```json
{
  "success": true,
  "message": "Product created successfully",
  "data": {
    "id": 123,
    "name": "Luxury Gold Necklace",
    "description": "Beautiful 24k gold necklace",
    "base_price": 599.99,
    "base_stock": 50,
    "category_id": 1,
    "is_active": true,
    "thumbnail": "https://cloudinary.com/...",
    "slug": "luxury-gold-necklace",
    "created_at": "2024-04-24T10:00:00Z"
  }
}
```

---

### 2. Get All Products

**Endpoint:** `GET /api/v1/products`

**Request:**
```bash
curl -X GET "http://localhost:5000/api/v1/products?page=1&limit=20&category_id=1&search=gold" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

**Query Parameters:**
- `page` (optional) - Page number (default: 1)
- `limit` (optional) - Items per page (default: 20)
- `category_id` (optional) - Filter by category
- `search` (optional) - Search in name/description

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": 123,
      "name": "Luxury Gold Necklace",
      "description": "Beautiful 24k gold necklace",
      "base_price": 599.99,
      "base_stock": 50,
      "thumbnail": "https://cloudinary.com/...",
      "slug": "luxury-gold-necklace",
      "is_active": true
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 100,
    "total_pages": 5
  }
}
```

---

### 3. Get Single Product

**Endpoint:** `GET /api/v1/products/:id`

**Request:**
```bash
curl -X GET "http://localhost:5000/api/v1/products/123" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": 123,
    "name": "Luxury Gold Necklace",
    "description": "Beautiful 24k gold necklace",
    "base_price": 599.99,
    "base_stock": 50,
    "category_id": 1,
    "thumbnail": "https://cloudinary.com/...",
    "afterimage": "https://cloudinary.com/...",
    "gallery": ["https://cloudinary.com/...", "https://cloudinary.com/..."],
    "variants": [...],
    "slug": "luxury-gold-necklace",
    "is_active": true,
    "created_at": "2024-04-24T10:00:00Z",
    "updated_at": "2024-04-24T10:00:00Z"
  }
}
```

---

### 4. Update Product

**Endpoint:** `PUT /api/v1/products/:id`  
**Content-Type:** `multipart/form-data` (with images) or `application/json` (without images)

**Request (with images):**
```bash
curl -X PUT "http://localhost:5000/api/v1/products/123" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -F "name=Updated Gold Necklace" \
  -F "base_price=699.99" \
  -F "base_stock=45" \
  -F "is_active=true" \
  -F "image=@/path/to/new-thumbnail.jpg"
```

**Request (JSON only):**
```bash
curl -X PUT "http://localhost:5000/api/v1/products/123" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Updated Gold Necklace",
    "base_price": 699.99,
    "base_stock": 45,
    "is_active": true
  }'
```

**Response:**
```json
{
  "success": true,
  "message": "Product updated successfully",
  "data": {
    "id": 123,
    "name": "Updated Gold Necklace",
    "base_price": 699.99,
    "base_stock": 45,
    "updated_at": "2024-04-24T11:00:00Z"
  }
}
```

---

### 5. Delete Product

**Endpoint:** `DELETE /api/v1/products/:id`

**Request:**
```bash
curl -X DELETE "http://localhost:5000/api/v1/products/123" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

**Response:**
```json
{
  "success": true,
  "message": "Product deleted successfully"
}
```

---

### 6. Get Product Image URLs (Admin Helper)

**Endpoint:** `GET /api/v1/admin/products/:id/image-urls`

**Request:**
```bash
curl -X GET "http://localhost:5000/api/v1/admin/products/123/image-urls" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

**Response:**
```json
{
  "success": true,
  "data": {
    "thumbnail": "https://cloudinary.com/...",
    "afterimage": "https://cloudinary.com/...",
    "gallery": [
      "https://cloudinary.com/...",
      "https://cloudinary.com/..."
    ]
  }
}
```

---

### 7. Set Product Thumbnail/Afterimage (Admin Helper)

**Endpoint:** `POST /api/v1/admin/products/:id/thumbnail-afterimage`

**Request:**
```bash
curl -X POST "http://localhost:5000/api/v1/admin/products/123/thumbnail-afterimage" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "thumbnail": "https://cloudinary.com/.../thumbnail.jpg",
    "afterimage": "https://cloudinary.com/.../afterimage.jpg"
  }'
```

**Response:**
```json
{
  "success": true,
  "message": "Thumbnail and afterimage updated successfully"
}
```

---

## Orders CRUD

### 1. Get All Orders (Admin)

**Endpoint:** `GET /api/v1/orders/admin/all`

**Request:**
```bash
curl -X GET "http://localhost:5000/api/v1/orders/admin/all?page=1&limit=20&order_status=pending&payment_status=paid" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

**Query Parameters:**
- `page` (optional) - Page number (default: 1)
- `limit` (optional) - Items per page (default: 20, max: 50)
- `order_status` (optional) - Filter by order status: pending, confirmed, processing, shipped, delivered, cancelled
- `payment_status` (optional) - Filter by payment status: pending, paid, failed, refunded
- `payment_method` (optional) - Filter by payment method: stripe, cod
- `search` (optional) - Search by order number, customer name, email
- `date_from` (optional) - Filter orders from date (ISO format)
- `date_to` (optional) - Filter orders to date (ISO format)

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "order_number": "ORD-20240424-000001",
      "is_guest_order": false,
      "customer": {
        "id": 1,
        "name": "John Doe",
        "email": "john@example.com",
        "phone": "+971501234567"
      },
      "payment": {
        "method": "stripe",
        "status": "paid",
        "transaction_id": "pi_..."
      },
      "pricing": {
        "subtotal": 500.00,
        "tax": 0,
        "shipping_fee": 26.00,
        "discount": 0,
        "total": 520.00,
        "currency": "AED"
      },
      "order_status": "confirmed",
      "items_count": 3,
      "shipping_address": {...},
      "created_at": "2024-04-24T10:00:00Z",
      "updated_at": "2024-04-24T10:00:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 100,
    "total_pages": 5
  }
}
```

---

### 2. Get Single Order (Admin)

**Endpoint:** `GET /api/v1/orders/admin/:orderId`

**Request:**
```bash
curl -X GET "http://localhost:5000/api/v1/orders/admin/uuid-here" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "order_number": "ORD-20240424-000001",
    "is_guest_order": false,
    "customer": {
      "id": 1,
      "name": "John Doe",
      "email": "john@example.com",
      "phone": "+971501234567"
    },
    "payment": {
      "method": "stripe",
      "status": "paid",
      "payment_due_amount": 0,
      "transaction_id": "pi_..."
    },
    "pricing": {
      "subtotal": 500.00,
      "tax": 0,
      "shipping_fee": 26.00,
      "discount": 0,
      "total": 520.00,
      "currency": "AED",
      "vat_percentage": 0
    },
    "coupon": {
      "code": "SAVE10",
      "type": "percentage",
      "value": 10,
      "discount_amount": 50.00
    },
    "order_status": "confirmed",
    "shipping_address": {
      "full_name": "John Doe",
      "phone": "+971501234567",
      "line1": "123 Main St",
      "city": "Dubai",
      "emirate": "Dubai",
      "country": "UAE"
    },
    "billing_address": {...},
    "items": [
      {
        "id": 1,
        "product_id": 123,
        "variant_id": 456,
        "name": "Gold Necklace",
        "slug": "gold-necklace",
        "thumbnail": "https://...",
        "sku": "GN-001",
        "variant": {
          "shade": "Gold",
          "model_no": "GN-001-G"
        },
        "quantity": 2,
        "unit_price": 250.00,
        "total_price": 500.00,
        "vat_percentage": 0
      }
    ],
    "timeline": [
      { "status": "created", "date": "2024-04-24T10:00:00Z" },
      { "status": "confirmed", "date": "2024-04-24T10:05:00Z" }
    ],
    "created_at": "2024-04-24T10:00:00Z",
    "updated_at": "2024-04-24T10:05:00Z"
  }
}
```

---

### 3. Update Order Status (Admin)

**Endpoint:** `PATCH /api/v1/orders/admin/:orderId/status`

**Request:**
```bash
curl -X PATCH "http://localhost:5000/api/v1/orders/admin/uuid-here/status" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "order_status": "shipped"
  }'
```

**Valid Order Statuses:**
- `pending`
- `confirmed`
- `processing`
- `shipped`
- `delivered`
- `cancelled`

**Response:**
```json
{
  "success": true,
  "message": "Order status updated successfully",
  "data": {
    "id": "uuid",
    "order_number": "ORD-20240424-000001",
    "order_status": "shipped",
    "previous_status": "confirmed",
    "updated_at": "2024-04-24T12:00:00Z"
  }
}
```

---

### 4. Update Payment Status (Admin)

**Endpoint:** `PATCH /api/v1/orders/admin/:orderId/payment-status`

**Request:**
```bash
curl -X PATCH "http://localhost:5000/api/v1/orders/admin/uuid-here/payment-status" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "payment_status": "paid"
  }'
```

**Valid Payment Statuses:**
- `pending`
- `paid`
- `failed`
- `refunded`

**Response:**
```json
{
  "success": true,
  "message": "Payment status updated successfully",
  "data": {
    "id": "uuid",
    "order_number": "ORD-20240424-000001",
    "payment_status": "paid",
    "payment_due_amount": 0,
    "previous_payment_status": "pending",
    "updated_at": "2024-04-24T12:00:00Z"
  }
}
```

---

### 5. Get Order Statistics (Admin)

**Endpoint:** `GET /api/v1/orders/admin/stats/summary`

**Request:**
```bash
curl -X GET "http://localhost:5000/api/v1/orders/admin/stats/summary?date_from=2024-01-01&date_to=2024-12-31" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

**Query Parameters:**
- `date_from` (optional) - Filter from date (ISO format)
- `date_to` (optional) - Filter to date (ISO format)

**Response:**
```json
{
  "success": true,
  "data": {
    "summary": {
      "total_orders": 500,
      "total_revenue": 250000.00,
      "average_order_value": 500.00,
      "paid_orders": 450,
      "pending_orders": 30,
      "delivered_orders": 400,
      "cancelled_orders": 20,
      "cod_orders": 200,
      "stripe_orders": 300
    },
    "status_breakdown": [
      { "status": "delivered", "count": 400 },
      { "status": "pending", "count": 30 },
      { "status": "cancelled", "count": 20 }
    ],
    "recent_orders": [
      {
        "id": "uuid",
        "order_number": "ORD-20240424-000001",
        "customer_name": "John Doe",
        "total": 520.00,
        "currency": "AED",
        "order_status": "confirmed",
        "payment_status": "paid",
        "created_at": "2024-04-24T10:00:00Z"
      }
    ]
  }
}
```

---

## Categories

### Get All Categories

**Endpoint:** `GET /api/v1/categories`

**Request:**
```bash
curl -X GET "http://localhost:5000/api/v1/categories"
```

**Response:**
```json
[
  {
    "id": 1,
    "name": "Jewelry",
    "subcategories": [
      { "id": 2, "name": "Necklaces" },
      { "id": 3, "name": "Rings" },
      { "id": 4, "name": "Earrings" }
    ]
  },
  {
    "id": 5,
    "name": "Watches",
    "subcategories": [
      { "id": 6, "name": "Luxury Watches" },
      { "id": 7, "name": "Smart Watches" }
    ]
  }
]
```

**Note:** Categories are managed directly in the database. There are no admin-specific CRUD endpoints for categories in the current implementation.

---

## User Management

### Get All Users (Admin)

**Endpoint:** `GET /api/v1/users/`

**Request:**
```bash
curl -X GET "http://localhost:5000/api/v1/users/?page=1&limit=20" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

**Query Parameters:**
- `page` (optional) - Page number (default: 1)
- `limit` (optional) - Items per page (default: 20)

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "name": "John Doe",
      "email": "john@example.com",
      "phone": "+971501234567",
      "role": "customer",
      "created_at": "2024-01-01T10:00:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 100,
    "total_pages": 5
  }
}
```

---

### Get Current User Profile

**Endpoint:** `GET /api/v1/users/me`

**Request:**
```bash
curl -X GET "http://localhost:5000/api/v1/users/me" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "name": "Admin User",
    "email": "admin@example.com",
    "phone": "+971501234567",
    "role": "admin",
    "created_at": "2024-01-01T10:00:00Z"
  }
}
```

---

## Reviews Management

### Delete Review (Admin)

**Endpoint:** `DELETE /api/v1/reviews/:reviewId`

**Request:**
```bash
curl -X DELETE "http://localhost:5000/api/v1/reviews/123" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

**Response:**
```json
{
  "success": true,
  "message": "Review deleted successfully"
}
```

---

### Get Product Reviews

**Endpoint:** `GET /api/v1/products/:productId/reviews`

**Request:**
```bash
curl -X GET "http://localhost:5000/api/v1/products/123/reviews?page=1&limit=10&sortBy=recent" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

**Query Parameters:**
- `page` (optional) - Page number (default: 1)
- `limit` (optional) - Items per page (default: 10, max: 100)
- `sortBy` (optional) - Sort option: recent, helpful, rating-high, rating-low

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "user_id": 5,
      "product_id": 123,
      "rating": 5,
      "title": "Amazing product!",
      "comment": "Great quality and fast delivery",
      "images": ["https://cloudinary.com/..."],
      "helpful_count": 10,
      "created_at": "2024-04-24T10:00:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 50,
    "total_pages": 5
  }
}
```

---

## Contact Queries

### Get All Contact Queries (Admin)

**Endpoint:** `GET /api/v1/contact/admin/all`

**Request:**
```bash
curl -X GET "http://localhost:5000/api/v1/contact/admin/all?page=1&limit=20&search=john" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

**Query Parameters:**
- `page` (optional) - Page number (default: 1)
- `limit` (optional) - Items per page (default: 20, max: 50)
- `search` (optional) - Search in name or message
- `email` (optional) - Filter by email

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "name": "John Doe",
      "email": "john@example.com",
      "phone": "+971501234567",
      "message": "I have a question about your products",
      "created_at": "2024-04-24T10:00:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 50,
    "total_pages": 3
  }
}
```

---

### Get Single Contact Query (Admin)

**Endpoint:** `GET /api/v1/contact/admin/:id`

**Request:**
```bash
curl -X GET "http://localhost:5000/api/v1/contact/admin/1" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "name": "John Doe",
    "email": "john@example.com",
    "phone": "+971501234567",
    "message": "I have a question about your products",
    "created_at": "2024-04-24T10:00:00Z"
  }
}
```

---

### Delete Contact Query (Admin)

**Endpoint:** `DELETE /api/v1/contact/admin/:id`

**Request:**
```bash
curl -X DELETE "http://localhost:5000/api/v1/contact/admin/1" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

**Response:**
```json
{
  "success": true,
  "message": "Contact query deleted successfully"
}
```

---

## Settings

### Get All Settings

**Endpoint:** `GET /api/v1/settings/`

**Request:**
```bash
curl -X GET "http://localhost:5000/api/v1/settings/"
```

**Response:**
```json
{
  "success": true,
  "data": {
    "media_provider": "cloudinary",
    "checkout_tax_percent": 0,
    "checkout_shipping_fee": 26,
    "checkout_free_shipping_threshold": 200
  }
}
```

---

### Get Media Provider

**Endpoint:** `GET /api/v1/settings/media-provider`

**Request:**
```bash
curl -X GET "http://localhost:5000/api/v1/settings/media-provider"
```

**Response:**
```json
{
  "success": true,
  "data": {
    "provider": "cloudinary"
  }
}
```

---

## Error Responses

All endpoints return consistent error responses:

**400 Bad Request:**
```json
{
  "success": false,
  "message": "Validation failed",
  "errors": [
    { "field": "email", "message": "Invalid email format" }
  ]
}
```

**401 Unauthorized:**
```json
{
  "success": false,
  "message": "Unauthorized"
}
```

**403 Forbidden:**
```json
{
  "success": false,
  "message": "Access denied. Admin role required."
}
```

**404 Not Found:**
```json
{
  "success": false,
  "message": "Resource not found"
}
```

**500 Internal Server Error:**
```json
{
  "success": false,
  "message": "Internal server error"
}
```

---

## Notes

- All admin endpoints require a valid JWT bearer token
- The token must belong to a user with `role: "admin"`
- Pagination is 1-indexed (page 1 is the first page)
- All monetary values are in AED currency
- Date/time values are in ISO 8601 format
- Image uploads support both Cloudinary and ImageKit (S3-backed) storage
- Use `mediaProvider=imagekit` query param or header to override default storage provider
