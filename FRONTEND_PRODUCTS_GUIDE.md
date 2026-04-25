# Frontend Guide - Fetching All Products

Complete guide for frontend developers on how to fetch all products with pagination.

**Base URL:** `http://localhost:5000`  
**Endpoint:** `GET /api/v1/products`

---

## Table of Contents

1. [Pagination Overview](#pagination-overview)
2. [Page-Based Pagination](#page-based-pagination)
3. [Cursor-Based Pagination](#cursor-based-pagination)
4. [Fetching All Products](#fetching-all-products)
5. [React Examples](#react-examples)
6. [Best Practices](#best-practices)

---

## Pagination Overview

The products API supports two pagination modes:

- **Page-Based:** Traditional pagination with page numbers (default: 20 items per page, max: 50)
- **Cursor-Based:** Efficient infinite scroll using product IDs as cursors

**Default behavior:** Returns 20 products per page  
**Maximum per request:** 50 products per request

---

## Page-Based Pagination

### Basic Request

```bash
curl -X GET "http://localhost:5000/api/v1/products?page=1&limit=20"
```

### Query Parameters

- `page` (optional) - Page number (default: 1)
- `limit` (optional) - Items per page (default: 20, max: 50)
- `category` (optional) - Filter by category ID
- `minPrice` (optional) - Minimum price filter
- `maxPrice` (optional) - Maximum price filter
- `color` (optional) - Filter by color
- `size` (optional) - Filter by size
- `tag` (optional) - Filter by tag code
- `sort` (optional) - Sort option: `price_low`, `price_high`, `newest`, `popular`
- `search` (optional) - Search term

### Response Structure

```json
{
  "data": [
    {
      "id": 123,
      "name": "Gold Necklace",
      "base_price": 599.99,
      "thumbnail": "https://...",
      "slug": "gold-necklace",
      "is_active": true
    }
  ],
  "pagination": {
    "hasMore": true,
    "nextCursor": 124
  }
}
```

---

## Cursor-Based Pagination

### Basic Request

```bash
curl -X GET "http://localhost:5000/api/v1/products?cursor=124&limit=20"
```

### How It Works

1. First request: No cursor needed, returns first page with `nextCursor`
2. Subsequent requests: Use `nextCursor` from previous response
3. When `hasMore` is false, you've reached the end

### Advantages

- More efficient for large datasets
- No duplicate items if data changes during pagination
- Better for infinite scroll implementations

---

## Fetching All Products

### Method 1: Sequential Page Loading (JavaScript)

```javascript
async function fetchAllProducts() {
  let allProducts = [];
  let page = 1;
  let hasMore = true;
  const limit = 50; // Maximum per request

  while (hasMore) {
    const response = await fetch(
      `http://localhost:5000/api/v1/products?page=${page}&limit=${limit}`
    );
    const data = await response.json();
    
    allProducts = [...allProducts, ...data.data];
    hasMore = data.pagination.hasMore;
    
    if (hasMore) {
      page++;
    }
  }

  return allProducts;
}

// Usage
const allProducts = await fetchAllProducts();
console.log(`Total products: ${allProducts.length}`);
```

### Method 2: Cursor-Based Loading (JavaScript)

```javascript
async function fetchAllProductsCursor() {
  let allProducts = [];
  let cursor = null;
  let hasMore = true;
  const limit = 50; // Maximum per request

  while (hasMore) {
    const url = cursor 
      ? `http://localhost:5000/api/v1/products?cursor=${cursor}&limit=${limit}`
      : `http://localhost:5000/api/v1/products?limit=${limit}`;
    
    const response = await fetch(url);
    const data = await response.json();
    
    allProducts = [...allProducts, ...data.data];
    hasMore = data.pagination.hasMore;
    cursor = data.pagination.nextCursor;
  }

  return allProducts;
}

// Usage
const allProducts = await fetchAllProductsCursor();
console.log(`Total products: ${allProducts.length}`);
```

### Method 3: Parallel Page Loading (Faster)

```javascript
async function fetchAllProductsParallel() {
  // First, get total count (if your API provides it)
  // Otherwise, fetch until hasMore is false
  
  let allProducts = [];
  let page = 1;
  const limit = 50;
  const maxConcurrent = 5; // Control concurrency

  while (true) {
    // Fetch multiple pages in parallel
    const promises = [];
    for (let i = 0; i < maxConcurrent; i++) {
      promises.push(
        fetch(`http://localhost:5000/api/v1/products?page=${page + i}&limit=${limit}`)
          .then(res => res.json())
      );
    }

    const results = await Promise.all(promises);
    
    let hasMoreInBatch = false;
    for (const data of results) {
      if (data.data && data.data.length > 0) {
        allProducts = [...allProducts, ...data.data];
        hasMoreInBatch = hasMoreInBatch || data.pagination.hasMore;
      }
    }

    if (!hasMoreInBatch) break;
    page += maxConcurrent;
  }

  return allProducts;
}
```

---

## React Examples

### Infinite Scroll with Cursor Pagination

```jsx
import { useState, useEffect, useCallback } from 'react';

function ProductList() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [cursor, setCursor] = useState(null);

  const fetchProducts = useCallback(async () => {
    if (loading || !hasMore) return;

    setLoading(true);
    try {
      const url = cursor 
        ? `http://localhost:5000/api/v1/products?cursor=${cursor}&limit=20`
        : `http://localhost:5000/api/v1/products?limit=20`;
      
      const response = await fetch(url);
      const data = await response.json();
      
      setProducts(prev => [...prev, ...data.data]);
      setHasMore(data.pagination.hasMore);
      setCursor(data.pagination.nextCursor);
    } catch (error) {
      console.error('Error fetching products:', error);
    } finally {
      setLoading(false);
    }
  }, [cursor, hasMore, loading]);

  useEffect(() => {
    fetchProducts();
  }, []); // Initial load

  // Infinite scroll handler
  const handleScroll = useCallback(() => {
    if (window.innerHeight + document.documentElement.scrollTop 
        >= document.documentElement.offsetHeight - 500) {
      fetchProducts();
    }
  }, [fetchProducts]);

  useEffect(() => {
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  return (
    <div>
      {products.map(product => (
        <div key={product.id}>
          <h3>{product.name}</h3>
          <p>{product.base_price} AED</p>
        </div>
      ))}
      {loading && <p>Loading more products...</p>}
      {!hasMore && <p>No more products</p>}
    </div>
  );
}
```

### Load More Button (Page-Based)

```jsx
import { useState, useEffect } from 'react';

function ProductListWithLoadMore() {
  const [products, setProducts] = useState([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);

  const fetchProducts = async (pageNum = 1) => {
    setLoading(true);
    try {
      const response = await fetch(
        `http://localhost:5000/api/v1/products?page=${pageNum}&limit=20`
      );
      const data = await response.json();
      
      if (pageNum === 1) {
        setProducts(data.data);
      } else {
        setProducts(prev => [...prev, ...data.data]);
      }
      
      setHasMore(data.pagination.hasMore);
    } catch (error) {
      console.error('Error fetching products:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProducts(1);
  }, []);

  const handleLoadMore = () => {
    if (!loading && hasMore) {
      const nextPage = page + 1;
      setPage(nextPage);
      fetchProducts(nextPage);
    }
  };

  return (
    <div>
      {products.map(product => (
        <div key={product.id}>
          <h3>{product.name}</h3>
          <p>{product.base_price} AED</p>
        </div>
      ))}
      {hasMore && (
        <button 
          onClick={handleLoadMore} 
          disabled={loading}
        >
          {loading ? 'Loading...' : 'Load More'}
        </button>
      )}
    </div>
  );
}
```

### Fetch All Products (with Progress)

```jsx
import { useState, useEffect } from 'react';

function AllProductsLoader() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);

  const fetchAllProducts = async () => {
    setLoading(true);
    setProgress(0);
    
    let allProducts = [];
    let cursor = null;
    let hasMore = true;
    let fetchedCount = 0;
    const limit = 50;

    while (hasMore) {
      const url = cursor 
        ? `http://localhost:5000/api/v1/products?cursor=${cursor}&limit=${limit}`
        : `http://localhost:5000/api/v1/products?limit=${limit}`;
      
      const response = await fetch(url);
      const data = await response.json();
      
      allProducts = [...allProducts, ...data.data];
      fetchedCount += data.data.length;
      setProgress(fetchedCount);
      
      hasMore = data.pagination.hasMore;
      cursor = data.pagination.nextCursor;
      
      // Small delay to prevent overwhelming the server
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    setProducts(allProducts);
    setLoading(false);
  };

  return (
    <div>
      <button 
        onClick={fetchAllProducts} 
        disabled={loading}
      >
        {loading ? `Loading... (${progress} products)` : 'Load All Products'}
      </button>
      
      {products.length > 0 && (
        <p>Total products loaded: {products.length}</p>
      )}
    </div>
  );
}
```

---

## Best Practices

### 1. Use Cursor Pagination for Infinite Scroll

Cursor pagination is more efficient and prevents duplicate items when data changes during pagination.

### 2. Implement Loading States

Always show loading indicators to improve user experience.

### 3. Handle Errors Gracefully

```javascript
try {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  const data = await response.json();
  // Process data
} catch (error) {
  console.error('Failed to fetch products:', error);
  // Show error message to user
}
```

### 4. Cache Results

Use React Query, SWR, or local storage to cache product data:

```javascript
// Using React Query
import { useInfiniteQuery } from '@tanstack/react-query';

function useProducts() {
  return useInfiniteQuery({
    queryKey: ['products'],
    queryFn: ({ pageParam }) => 
      fetch(`http://localhost:5000/api/v1/products?cursor=${pageParam}&limit=20`)
        .then(res => res.json()),
    getNextPageParam: (lastPage) => lastPage.pagination.nextCursor,
  });
}
```

### 5. Debounce Search Queries

When implementing search, debounce the input to avoid excessive API calls:

```javascript
import { useState, useEffect } from 'react';
import { debounce } from 'lodash';

function ProductSearch() {
  const [searchTerm, setSearchTerm] = useState('');
  const [results, setResults] = useState([]);

  const debouncedSearch = debounce(async (term) => {
    if (term.length < 2) {
      setResults([]);
      return;
    }
    
    const response = await fetch(
      `http://localhost:5000/api/v1/products?search=${term}&limit=20`
    );
    const data = await response.json();
    setResults(data.data);
  }, 300);

  useEffect(() => {
    debouncedSearch(searchTerm);
    return () => debouncedSearch.cancel();
  }, [searchTerm]);

  return (
    <div>
      <input
        type="text"
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        placeholder="Search products..."
      />
      {/* Render results */}
    </div>
  );
}
```

### 6. Filter by Category

```javascript
async function fetchProductsByCategory(categoryId) {
  const response = await fetch(
    `http://localhost:5000/api/v1/products?category=${categoryId}&limit=50`
  );
  const data = await response.json();
  return data.data;
}
```

### 7. Sort Products

```javascript
async function fetchProductsSorted(sortBy) {
  const response = await fetch(
    `http://localhost:5000/api/v1/products?sort=${sortBy}&limit=50`
  );
  const data = await response.json();
  return data.data;
}

// Sort options: 'price_low', 'price_high', 'newest', 'popular'
```

### 8. Filter by Price Range

```javascript
async function fetchProductsByPriceRange(minPrice, maxPrice) {
  const response = await fetch(
    `http://localhost:5000/api/v1/products?minPrice=${minPrice}&maxPrice=${maxPrice}&limit=50`
  );
  const data = await response.json();
  return data.data;
}
```

---

## Complete Example: Product Catalog with Filters

```jsx
import { useState, useEffect } from 'react';

function ProductCatalog() {
  const [products, setProducts] = useState([]);
  const [filters, setFilters] = useState({
    category: null,
    minPrice: null,
    maxPrice: null,
    sort: 'newest',
    search: ''
  });
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);

  const buildQueryString = () => {
    const params = new URLSearchParams();
    params.append('page', page);
    params.append('limit', 20);
    
    if (filters.category) params.append('category', filters.category);
    if (filters.minPrice) params.append('minPrice', filters.minPrice);
    if (filters.maxPrice) params.append('maxPrice', filters.maxPrice);
    if (filters.sort) params.append('sort', filters.sort);
    if (filters.search) params.append('search', filters.search);
    
    return params.toString();
  };

  const fetchProducts = async (reset = false) => {
    setLoading(true);
    try {
      const queryString = buildQueryString();
      const response = await fetch(
        `http://localhost:5000/api/v1/products?${queryString}`
      );
      const data = await response.json();
      
      if (reset) {
        setProducts(data.data);
        setPage(1);
      } else {
        setProducts(prev => [...prev, ...data.data]);
      }
      
      setHasMore(data.pagination.hasMore);
    } catch (error) {
      console.error('Error fetching products:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProducts(true);
  }, [filters]);

  const handleLoadMore = () => {
    if (!loading && hasMore) {
      setPage(prev => prev + 1);
      fetchProducts();
    }
  };

  const handleFilterChange = (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  return (
    <div>
      {/* Filters */}
      <div>
        <select 
          onChange={(e) => handleFilterChange('category', e.target.value)}
        >
          <option value="">All Categories</option>
          <option value="1">Jewelry</option>
          <option value="2">Watches</option>
        </select>
        
        <input
          type="number"
          placeholder="Min Price"
          onChange={(e) => handleFilterChange('minPrice', e.target.value)}
        />
        
        <input
          type="number"
          placeholder="Max Price"
          onChange={(e) => handleFilterChange('maxPrice', e.target.value)}
        />
        
        <select
          onChange={(e) => handleFilterChange('sort', e.target.value)}
        >
          <option value="newest">Newest</option>
          <option value="price_low">Price: Low to High</option>
          <option value="price_high">Price: High to Low</option>
          <option value="popular">Popular</option>
        </select>
        
        <input
          type="text"
          placeholder="Search..."
          onChange={(e) => handleFilterChange('search', e.target.value)}
        />
      </div>

      {/* Product Grid */}
      <div>
        {products.map(product => (
          <div key={product.id}>
            <img src={product.thumbnail} alt={product.name} />
            <h3>{product.name}</h3>
            <p>{product.base_price} AED</p>
          </div>
        ))}
      </div>

      {/* Load More Button */}
      {hasMore && (
        <button 
          onClick={handleLoadMore} 
          disabled={loading}
        >
          {loading ? 'Loading...' : 'Load More'}
        </button>
      )}
    </div>
  );
}
```

---

## Summary

- **Default limit:** 20 products per request
- **Maximum limit:** 50 products per request
- **Pagination modes:** Page-based and cursor-based
- **Cursor pagination** is recommended for infinite scroll
- **Page-based pagination** is simpler for traditional pagination
- Always implement loading states and error handling
- Use caching libraries like React Query for better performance
- Debounce search queries to avoid excessive API calls
