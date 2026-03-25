# Admin Panel Frontend Authentication Guide

## Production API Endpoint

```
PRODUCTION: https://just-gold-backend-render.onrender.com/api/v1
LOCAL DEV: http://localhost:5000/api/v1
```

---

## How JWT Authentication Works

### Step 1: Admin Logs In

```javascript
// Request
POST https://just-gold-backend-render.onrender.com/api/v1/auth/login
{
  "email": "admin@goldenegg.com",
  "password": "password"
}

// Response
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": 1,
    "email": "admin@goldenegg.com",
    "name": "Admin User",
    "role": "admin"
  }
}
```

### Step 2: Store Token Locally

```javascript
// Save token in localStorage
localStorage.setItem('adminToken', response.token)
localStorage.setItem('adminUser', JSON.stringify(response.user))
```

### Step 3: Send Token with Every Request

```javascript
// All API calls need this header
fetch('https://just-gold-backend-render.onrender.com/api/v1/products', {
  method: 'GET',
  headers: {
    'Authorization': `Bearer ${localStorage.getItem('adminToken')}`,
    'Content-Type': 'application/json'
  }
})
```

### Step 4: Token Expires → Login Again

When token expires (usually 24 hours):
- User gets 401 Unauthorized error
- Redirect to login page
- Admin logs in again
- Get new token

---

## Frontend Setup

### Configuration File

Create `src/config/api.js`:

```javascript
const API_BASE = process.env.REACT_APP_API_BASE || 'https://just-gold-backend-render.onrender.com/api/v1'

export const getAuthHeaders = () => {
  const token = localStorage.getItem('adminToken')
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  }
}

export const fetchWithAuth = async (endpoint, options = {}) => {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      ...getAuthHeaders(),
      ...options.headers
    }
  })
  
  if (response.status === 401) {
    // Token expired, redirect to login
    localStorage.removeItem('adminToken')
    window.location.href = '/login'
    return
  }
  
  return response
}

export default API_BASE
```

---

## Implementation in React Components

### Login Component

```javascript
import { useState } from 'react'
import API_BASE from '../config/api'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  const handleLogin = async (e) => {
    e.preventDefault()
    
    try {
      const response = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      })
      
      if (!response.ok) {
        setError('Invalid email or password')
        return
      }
      
      const data = await response.json()
      
      // Save token
      localStorage.setItem('adminToken', data.token)
      localStorage.setItem('adminUser', JSON.stringify(data.user))
      
      // Redirect to dashboard
      window.location.href = '/dashboard'
    } catch (err) {
      setError('Login failed: ' + err.message)
    }
  }

  return (
    <form onSubmit={handleLogin}>
      <input
        type="email"
        placeholder="Admin Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />
      <input
        type="password"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />
      {error && <p style={{ color: 'red' }}>{error}</p>}
      <button type="submit">Login</button>
    </form>
  )
}
```

### Protected Component (with Authentication)

```javascript
import { useEffect, useState } from 'react'
import { fetchWithAuth } from '../config/api'

export default function ProductsPage() {
  const [products, setProducts] = useState([])
  const [error, setError] = useState('')

  useEffect(() => {
    const loadProducts = async () => {
      try {
        const response = await fetchWithAuth('/products')
        
        if (!response.ok) {
          throw new Error('Failed to load products')
        }
        
        const data = await response.json()
        setProducts(data)
      } catch (err) {
        setError(err.message)
      }
    }

    loadProducts()
  }, [])

  return (
    <div>
      <h1>Products</h1>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      <ul>
        {products.map((product) => (
          <li key={product.id}>{product.name}</li>
        ))}
      </ul>
    </div>
  )
}
```

### Upload Image with Authentication

```javascript
const uploadProductImage = async (productId, file) => {
  const formData = new FormData()
  formData.append('image', file)

  const token = localStorage.getItem('adminToken')
  
  const response = await fetch(
    `https://just-gold-backend-render.onrender.com/api/v1/products/${productId}/upload`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`
        // Don't set Content-Type for FormData, browser will set it
      },
      body: formData
    }
  )

  return response.json()
}
```

---

## Environment Variables

Create `.env` file in frontend:

```
REACT_APP_API_BASE=https://just-gold-backend-render.onrender.com/api/v1
```

Or for local development, `.env.local`:

```
REACT_APP_API_BASE=http://localhost:5000/api/v1
```

Then use in code:

```javascript
const API_BASE = process.env.REACT_APP_API_BASE
```

---

## API Endpoints Reference

### Authentication

```javascript
// Login
POST /auth/login
Body: { email, password }
Response: { token, user }

// Logout (if exists)
POST /auth/logout
Header: Authorization: Bearer {token}
```

### Products

```javascript
// Get all products
GET /products
Header: Authorization: Bearer {token}

// Get single product
GET /products/{id}
Header: Authorization: Bearer {token}

// Create product
POST /products
Header: Authorization: Bearer {token}
Body: { name, price, description, ... }

// Update product
PUT /products/{id}
Header: Authorization: Bearer {token}
Body: { name, price, description, ... }

// Upload product image
POST /products/{id}/upload
Header: Authorization: Bearer {token}
Body: FormData with image file
```

### Orders

```javascript
// Get all orders
GET /orders
Header: Authorization: Bearer {token}

// Get single order
GET /orders/{id}
Header: Authorization: Bearer {token}

// Update order status
PUT /orders/{id}
Header: Authorization: Bearer {token}
Body: { status }
```

---

## Error Handling

### Handle Expired Token

```javascript
const handleResponse = async (response) => {
  if (response.status === 401) {
    // Token expired
    localStorage.removeItem('adminToken')
    localStorage.removeItem('adminUser')
    window.location.href = '/login'
    return null
  }
  
  if (!response.ok) {
    throw new Error(`API Error: ${response.status}`)
  }
  
  return response.json()
}
```

### Handle Network Errors

```javascript
const fetchWithErrorHandling = async (url, options) => {
  try {
    const response = await fetch(url, options)
    return await handleResponse(response)
  } catch (error) {
    console.error('Network error:', error)
    // Show error to user
    throw error
  }
}
```

---

## Security Best Practices

### ✅ DO:

- ✅ Store token in localStorage (or sessionStorage for more security)
- ✅ Send token in Authorization header
- ✅ Clear token on logout
- ✅ Check token expiration
- ✅ Use HTTPS in production
- ✅ Validate user input

### ❌ DON'T:

- ❌ Store token in URL
- ❌ Store password in localStorage
- ❌ Send token in URL query params
- ❌ Log token in console (in production)
- ❌ Use HTTP in production (always HTTPS)
- ❌ Trust client-side validation only

---

## Switching Between Local and Production

### Local Development

```javascript
// .env.local
REACT_APP_API_BASE=http://localhost:5000/api/v1
```

Run with: `npm start`

### Production Deployment

```javascript
// .env.production
REACT_APP_API_BASE=https://just-gold-backend-render.onrender.com/api/v1
```

Build with: `npm run build`

**No code changes needed. Just different environment files.**

---

## Testing Authentication

### Test Login

```bash
curl -X POST https://just-gold-backend-render.onrender.com/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@goldenegg.com","password":"password"}'
```

### Test Protected Endpoint

```bash
curl -X GET https://just-gold-backend-render.onrender.com/api/v1/products \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

---

## Summary

**Admin Panel Flow:**

1. Admin visits `/login`
2. Enters email + password
3. Frontend calls `POST /auth/login`
4. Backend returns JWT token
5. Frontend stores token in localStorage
6. Frontend sends token with every API request
7. Backend verifies token, returns data
8. Admin sees products/orders/etc
9. When token expires → redirect to login

**That's it. Production ready. Secure. Scalable.**
