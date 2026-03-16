# 📦 Admin Orders API Guide

## Overview

This guide provides complete documentation for the Admin Orders API endpoints. These endpoints allow admin users to manage orders, update statuses, and view statistics.

**Base URL:** `http://localhost:5000/api/v1`

**Authentication:** All admin endpoints require:
- Bearer token authentication
- User role must be `admin`

**Headers Required:**
```
Authorization: Bearer YOUR_JWT_TOKEN
Content-Type: application/json
```

---

## 🔐 Authentication Example

```javascript
// Login first to get token
const loginResponse = await fetch('http://localhost:5000/api/v1/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: 'admin@justgold.com',
    password: 'adminpassword'
  })
});

const { token } = await loginResponse.json();

// Use token in all admin requests
const headers = {
  'Authorization': `Bearer ${token}`,
  'Content-Type': 'application/json'
};
```

---

## 📋 API Endpoints

### 1️⃣ Get All Orders (Paginated)

Retrieves all orders with pagination and filtering options.

```
GET /api/v1/orders/admin/all
```

**Query Parameters:**

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `page` | number | Page number (default: 1) | `1` |
| `limit` | number | Items per page (default: 20, max: 50) | `20` |
| `order_status` | string | Filter by order status | `pending`, `confirmed`, `processing`, `shipped`, `delivered`, `cancelled` |
| `payment_status` | string | Filter by payment status | `pending`, `paid`, `failed`, `refunded` |
| `payment_method` | string | Filter by payment method | `stripe`, `cod` |
| `search` | string | Search by order number, customer name/email | `ORD-2026` |
| `date_from` | string | Filter from date (ISO format) | `2026-01-01` |
| `date_to` | string | Filter to date (ISO format) | `2026-12-31` |

**cURL Example:**
```bash
curl -X GET "http://localhost:5000/api/v1/orders/admin/all?page=1&limit=20&order_status=pending" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**JavaScript Example:**
```javascript
const getOrders = async (params = {}) => {
  const query = new URLSearchParams({
    page: params.page || 1,
    limit: params.limit || 20,
    ...(params.order_status && { order_status: params.order_status }),
    ...(params.payment_status && { payment_status: params.payment_status }),
    ...(params.payment_method && { payment_method: params.payment_method }),
    ...(params.search && { search: params.search }),
    ...(params.date_from && { date_from: params.date_from }),
    ...(params.date_to && { date_to: params.date_to }),
  }).toString();

  const response = await fetch(`http://localhost:5000/api/v1/orders/admin/all?${query}`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });

  return response.json();
};

// Usage
const orders = await getOrders({ page: 1, order_status: 'pending' });
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "order_number": "ORD-2026-000001",
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
        "financial_status": "paid",
        "transaction_id": "pi_3PxyzABCDEF123456"
      },
      "pricing": {
        "subtotal": 250.00,
        "tax": 12.50,
        "shipping_fee": 0,
        "discount": 25.00,
        "total": 237.50,
        "currency": "AED"
      },
      "order_status": "confirmed",
      "items_count": 3,
      "shipping_address": {
        "full_name": "John Doe",
        "phone": "+971501234567",
        "line1": "123 Main Street",
        "line2": "Apt 4B",
        "city": "Dubai",
        "emirate": "Dubai",
        "country": "UAE"
      },
      "created_at": "2026-03-12T10:30:00.000Z",
      "updated_at": "2026-03-12T10:35:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 150,
    "total_pages": 8
  }
}
```

---

### 2️⃣ Get Single Order Details

Retrieves complete details for a specific order.

```
GET /api/v1/orders/admin/:orderId
```

**cURL Example:**
```bash
curl -X GET "http://localhost:5000/api/v1/orders/admin/a1b2c3d4-e5f6-7890-abcd-ef1234567890" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**JavaScript Example:**
```javascript
const getOrderDetails = async (orderId) => {
  const response = await fetch(`http://localhost:5000/api/v1/orders/admin/${orderId}`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });

  return response.json();
};

// Usage
const order = await getOrderDetails('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "order_number": "ORD-2026-000001",
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
      "financial_status": "paid",
      "payment_due_amount": 0,
      "transaction_id": "pi_3PxyzABCDEF123456"
    },
    "pricing": {
      "subtotal": 250.00,
      "tax": 12.50,
      "shipping_fee": 0,
      "discount": 25.00,
      "total": 237.50,
      "currency": "AED",
      "vat_percentage": 5
    },
    "coupon": {
      "code": "SAVE10",
      "type": "percentage",
      "value": 10,
      "discount_amount": 25.00
    },
    "order_status": "confirmed",
    "shipping_address": {
      "label": "Home",
      "full_name": "John Doe",
      "phone": "+971501234567",
      "line1": "123 Main Street",
      "line2": "Apt 4B",
      "city": "Dubai",
      "emirate": "Dubai",
      "country": "UAE"
    },
    "billing_address": {
      "label": "Home",
      "full_name": "John Doe",
      "phone": "+971501234567",
      "line1": "123 Main Street",
      "line2": "Apt 4B",
      "city": "Dubai",
      "emirate": "Dubai",
      "country": "UAE"
    },
    "items": [
      {
        "id": 1,
        "product_id": 15,
        "variant_id": 42,
        "name": "Luxury Lipstick",
        "slug": "luxury-lipstick",
        "thumbnail": "https://res.cloudinary.com/.../lipstick.jpg",
        "sku": "LIP-2026-001",
        "variant": {
          "shade": "Ruby Red",
          "model_no": "LIP-001-RR"
        },
        "quantity": 2,
        "unit_price": 125.00,
        "total_price": 250.00,
        "vat_percentage": 5
      }
    ],
    "timeline": [
      { "status": "created", "date": "2026-03-12T10:30:00.000Z" },
      { "status": "confirmed", "date": "2026-03-12T10:35:00.000Z" }
    ],
    "created_at": "2026-03-12T10:30:00.000Z",
    "updated_at": "2026-03-12T10:35:00.000Z"
  }
}
```

---

### 3️⃣ Update Order Status

Updates the order fulfillment status.

```
PATCH /api/v1/orders/admin/:orderId/status
```

**Valid Status Values:**
| Status | Description |
|--------|-------------|
| `pending` | Order awaiting confirmation |
| `confirmed` | Order confirmed |
| `processing` | Order being prepared |
| `shipped` | Order shipped to customer |
| `delivered` | Order delivered |
| `cancelled` | Order cancelled |

**Status Transition Rules:**
- Orders can only move forward in the workflow (pending → confirmed → processing → shipped → delivered)
- Orders can only be cancelled when status is `pending` or `confirmed`
- Cannot go backwards in the status chain

**Request Body:**
```json
{
  "order_status": "processing"
}
```

**cURL Example:**
```bash
curl -X PATCH "http://localhost:5000/api/v1/orders/admin/a1b2c3d4-e5f6-7890-abcd-ef1234567890/status" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"order_status": "processing"}'
```

**JavaScript Example:**
```javascript
const updateOrderStatus = async (orderId, newStatus) => {
  const response = await fetch(`http://localhost:5000/api/v1/orders/admin/${orderId}/status`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ order_status: newStatus })
  });

  return response.json();
};

// Usage
await updateOrderStatus('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'shipped');
```

**Response:**
```json
{
  "success": true,
  "message": "Order status updated successfully",
  "data": {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "order_number": "ORD-2026-000001",
    "order_status": "processing",
    "previous_status": "confirmed",
    "updated_at": "2026-03-12T11:00:00.000Z"
  }
}
```

**Error Response (Invalid Transition):**
```json
{
  "success": false,
  "message": "Cannot change status from delivered to processing"
}
```

---

### 4️⃣ Update Payment Status

Updates the payment/financial status of an order.

```
PATCH /api/v1/orders/admin/:orderId/payment-status
```

**Valid Payment Status Values:**
| Status | Description |
|--------|-------------|
| `pending` | Payment not received |
| `paid` | Payment completed |
| `failed` | Payment failed |
| `refunded` | Payment refunded |

**Valid Financial Status Values:**
| Status | Description |
|--------|-------------|
| `unpaid` | No payment received |
| `paid` | Full payment received |
| `partially_refunded` | Partial refund issued |
| `refunded` | Full refund issued |

**Request Body:**
```json
{
  "payment_status": "paid",
  "financial_status": "paid"
}
```

**cURL Example:**
```bash
curl -X PATCH "http://localhost:5000/api/v1/orders/admin/a1b2c3d4-e5f6-7890-abcd-ef1234567890/payment-status" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"payment_status": "paid"}'
```

**JavaScript Example:**
```javascript
const updatePaymentStatus = async (orderId, paymentStatus, financialStatus = null) => {
  const body = { payment_status: paymentStatus };
  if (financialStatus) {
    body.financial_status = financialStatus;
  }

  const response = await fetch(`http://localhost:5000/api/v1/orders/admin/${orderId}/payment-status`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  return response.json();
};

// Mark COD order as paid when customer pays
await updatePaymentStatus('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'paid');

// Issue refund
await updatePaymentStatus('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'refunded', 'refunded');
```

**Response:**
```json
{
  "success": true,
  "message": "Payment status updated successfully",
  "data": {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "order_number": "ORD-2026-000001",
    "payment_status": "paid",
    "financial_status": "paid",
    "payment_due_amount": 0,
    "previous_payment_status": "pending",
    "previous_financial_status": "unpaid",
    "updated_at": "2026-03-12T11:00:00.000Z"
  }
}
```

---

### 5️⃣ Get Order Statistics

Retrieves summary statistics for orders dashboard.

```
GET /api/v1/orders/admin/stats/summary
```

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `date_from` | string | Start date filter (ISO format) |
| `date_to` | string | End date filter (ISO format) |

**cURL Example:**
```bash
curl -X GET "http://localhost:5000/api/v1/orders/admin/stats/summary?date_from=2026-03-01&date_to=2026-03-31" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**JavaScript Example:**
```javascript
const getOrderStats = async (dateFrom = null, dateTo = null) => {
  const params = new URLSearchParams();
  if (dateFrom) params.append('date_from', dateFrom);
  if (dateTo) params.append('date_to', dateTo);

  const query = params.toString() ? `?${params.toString()}` : '';

  const response = await fetch(`http://localhost:5000/api/v1/orders/admin/stats/summary${query}`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });

  return response.json();
};

// All-time stats
const allStats = await getOrderStats();

// Monthly stats
const marchStats = await getOrderStats('2026-03-01', '2026-03-31');
```

**Response:**
```json
{
  "success": true,
  "data": {
    "summary": {
      "total_orders": 150,
      "total_revenue": 35750.50,
      "average_order_value": 238.34,
      "paid_orders": 120,
      "pending_orders": 20,
      "delivered_orders": 95,
      "cancelled_orders": 5,
      "cod_orders": 45,
      "stripe_orders": 105
    },
    "status_breakdown": [
      { "status": "delivered", "count": 95 },
      { "status": "confirmed", "count": 30 },
      { "status": "pending", "count": 15 },
      { "status": "shipped", "count": 5 },
      { "status": "cancelled", "count": 5 }
    ],
    "recent_orders": [
      {
        "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        "order_number": "ORD-2026-000150",
        "customer_name": "Jane Smith",
        "total": 325.00,
        "currency": "AED",
        "order_status": "confirmed",
        "payment_status": "paid",
        "created_at": "2026-03-12T12:00:00.000Z"
      }
    ]
  }
}
```

---

## 🖥️ React Admin Panel Implementation Examples

### Orders List Component

```jsx
import React, { useState, useEffect } from 'react';

const OrdersList = () => {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ page: 1, total_pages: 1 });
  const [filters, setFilters] = useState({
    order_status: '',
    payment_status: '',
    search: ''
  });

  const fetchOrders = async (page = 1) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page,
        limit: 20,
        ...Object.fromEntries(
          Object.entries(filters).filter(([_, v]) => v !== '')
        )
      });

      const response = await fetch(
        `${API_BASE_URL}/orders/admin/all?${params}`,
        {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`
          }
        }
      );

      const data = await response.json();
      if (data.success) {
        setOrders(data.data);
        setPagination(data.pagination);
      }
    } catch (error) {
      console.error('Failed to fetch orders:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrders(pagination.page);
  }, [filters]);

  const handleStatusUpdate = async (orderId, newStatus) => {
    try {
      const response = await fetch(
        `${API_BASE_URL}/orders/admin/${orderId}/status`,
        {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ order_status: newStatus })
        }
      );

      const data = await response.json();
      if (data.success) {
        // Update local state
        setOrders(orders.map(order =>
          order.id === orderId
            ? { ...order, order_status: newStatus }
            : order
        ));
        alert('Status updated successfully!');
      } else {
        alert(data.message);
      }
    } catch (error) {
      console.error('Failed to update status:', error);
    }
  };

  const getStatusBadgeColor = (status) => {
    const colors = {
      pending: 'bg-yellow-100 text-yellow-800',
      confirmed: 'bg-blue-100 text-blue-800',
      processing: 'bg-purple-100 text-purple-800',
      shipped: 'bg-indigo-100 text-indigo-800',
      delivered: 'bg-green-100 text-green-800',
      cancelled: 'bg-red-100 text-red-800'
    };
    return colors[status] || 'bg-gray-100 text-gray-800';
  };

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">Orders Management</h1>

      {/* Filters */}
      <div className="flex gap-4 mb-6">
        <input
          type="text"
          placeholder="Search orders..."
          className="border px-4 py-2 rounded"
          value={filters.search}
          onChange={(e) => setFilters({ ...filters, search: e.target.value })}
        />

        <select
          className="border px-4 py-2 rounded"
          value={filters.order_status}
          onChange={(e) => setFilters({ ...filters, order_status: e.target.value })}
        >
          <option value="">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="confirmed">Confirmed</option>
          <option value="processing">Processing</option>
          <option value="shipped">Shipped</option>
          <option value="delivered">Delivered</option>
          <option value="cancelled">Cancelled</option>
        </select>

        <select
          className="border px-4 py-2 rounded"
          value={filters.payment_status}
          onChange={(e) => setFilters({ ...filters, payment_status: e.target.value })}
        >
          <option value="">All Payments</option>
          <option value="pending">Pending</option>
          <option value="paid">Paid</option>
          <option value="failed">Failed</option>
          <option value="refunded">Refunded</option>
        </select>
      </div>

      {/* Orders Table */}
      <table className="w-full border-collapse border">
        <thead>
          <tr className="bg-gray-100">
            <th className="border p-3 text-left">Order #</th>
            <th className="border p-3 text-left">Customer</th>
            <th className="border p-3 text-left">Total</th>
            <th className="border p-3 text-left">Payment</th>
            <th className="border p-3 text-left">Status</th>
            <th className="border p-3 text-left">Date</th>
            <th className="border p-3 text-left">Actions</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <tr key={order.id} className="hover:bg-gray-50">
              <td className="border p-3 font-mono">{order.order_number}</td>
              <td className="border p-3">
                <div>{order.customer.name}</div>
                <div className="text-sm text-gray-500">{order.customer.email}</div>
              </td>
              <td className="border p-3">
                {order.pricing.currency} {order.pricing.total.toFixed(2)}
              </td>
              <td className="border p-3">
                <span className={`px-2 py-1 rounded text-xs ${
                  order.payment.status === 'paid' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
                }`}>
                  {order.payment.status}
                </span>
              </td>
              <td className="border p-3">
                <span className={`px-2 py-1 rounded text-xs ${getStatusBadgeColor(order.order_status)}`}>
                  {order.order_status}
                </span>
              </td>
              <td className="border p-3 text-sm">
                {new Date(order.created_at).toLocaleDateString()}
              </td>
              <td className="border p-3">
                <select
                  className="border px-2 py-1 rounded text-sm"
                  value={order.order_status}
                  onChange={(e) => handleStatusUpdate(order.id, e.target.value)}
                >
                  <option value="pending">Pending</option>
                  <option value="confirmed">Confirmed</option>
                  <option value="processing">Processing</option>
                  <option value="shipped">Shipped</option>
                  <option value="delivered">Delivered</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Pagination */}
      <div className="flex justify-between items-center mt-4">
        <span>
          Page {pagination.page} of {pagination.total_pages} ({pagination.total} orders)
        </span>
        <div className="flex gap-2">
          <button
            className="px-4 py-2 border rounded disabled:opacity-50"
            disabled={pagination.page <= 1}
            onClick={() => fetchOrders(pagination.page - 1)}
          >
            Previous
          </button>
          <button
            className="px-4 py-2 border rounded disabled:opacity-50"
            disabled={pagination.page >= pagination.total_pages}
            onClick={() => fetchOrders(pagination.page + 1)}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
};

export default OrdersList;
```

### Dashboard Stats Component

```jsx
import React, { useState, useEffect } from 'react';

const OrdersDashboard = () => {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const response = await fetch(
          `${API_BASE_URL}/orders/admin/stats/summary`,
          {
            headers: {
              'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
          }
        );

        const data = await response.json();
        if (data.success) {
          setStats(data.data);
        }
      } catch (error) {
        console.error('Failed to fetch stats:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, []);

  if (loading) return <div>Loading...</div>;
  if (!stats) return <div>Failed to load statistics</div>;

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">Orders Dashboard</h1>

      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        <div className="bg-white p-6 rounded-lg shadow">
          <h3 className="text-gray-500 text-sm">Total Orders</h3>
          <p className="text-3xl font-bold">{stats.summary.total_orders}</p>
        </div>
        <div className="bg-white p-6 rounded-lg shadow">
          <h3 className="text-gray-500 text-sm">Total Revenue</h3>
          <p className="text-3xl font-bold">
            AED {stats.summary.total_revenue.toLocaleString()}
          </p>
        </div>
        <div className="bg-white p-6 rounded-lg shadow">
          <h3 className="text-gray-500 text-sm">Average Order Value</h3>
          <p className="text-3xl font-bold">
            AED {stats.summary.average_order_value.toFixed(2)}
          </p>
        </div>
        <div className="bg-white p-6 rounded-lg shadow">
          <h3 className="text-gray-500 text-sm">Pending Orders</h3>
          <p className="text-3xl font-bold text-yellow-600">
            {stats.summary.pending_orders}
          </p>
        </div>
      </div>

      {/* Status Breakdown */}
      <div className="grid grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-lg shadow">
          <h3 className="text-lg font-semibold mb-4">Order Status Breakdown</h3>
          <div className="space-y-3">
            {stats.status_breakdown.map((item) => (
              <div key={item.status} className="flex justify-between items-center">
                <span className="capitalize">{item.status}</span>
                <span className="font-semibold">{item.count}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow">
          <h3 className="text-lg font-semibold mb-4">Recent Orders</h3>
          <div className="space-y-3">
            {stats.recent_orders.map((order) => (
              <div key={order.id} className="flex justify-between items-center border-b pb-2">
                <div>
                  <span className="font-mono text-sm">{order.order_number}</span>
                  <span className="text-gray-500 text-sm ml-2">{order.customer_name}</span>
                </div>
                <span className="font-semibold">
                  {order.currency} {order.total.toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default OrdersDashboard;
```

---

## 📱 API Service Helper (Recommended)

Create a reusable API service for your admin panel:

```javascript
// services/ordersApi.js

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000/api/v1';

const getAuthHeaders = () => ({
  'Authorization': `Bearer ${localStorage.getItem('token')}`,
  'Content-Type': 'application/json'
});

export const ordersApi = {
  // Get all orders with filters
  getAll: async (params = {}) => {
    const query = new URLSearchParams(
      Object.entries(params).filter(([_, v]) => v != null && v !== '')
    ).toString();

    const response = await fetch(`${API_BASE_URL}/orders/admin/all?${query}`, {
      headers: getAuthHeaders()
    });
    return response.json();
  },

  // Get single order
  getById: async (orderId) => {
    const response = await fetch(`${API_BASE_URL}/orders/admin/${orderId}`, {
      headers: getAuthHeaders()
    });
    return response.json();
  },

  // Update order status
  updateStatus: async (orderId, order_status) => {
    const response = await fetch(`${API_BASE_URL}/orders/admin/${orderId}/status`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
      body: JSON.stringify({ order_status })
    });
    return response.json();
  },

  // Update payment status
  updatePaymentStatus: async (orderId, payment_status, financial_status = null) => {
    const body = { payment_status };
    if (financial_status) body.financial_status = financial_status;

    const response = await fetch(`${API_BASE_URL}/orders/admin/${orderId}/payment-status`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
      body: JSON.stringify(body)
    });
    return response.json();
  },

  // Get statistics
  getStats: async (date_from = null, date_to = null) => {
    const params = new URLSearchParams();
    if (date_from) params.append('date_from', date_from);
    if (date_to) params.append('date_to', date_to);

    const query = params.toString() ? `?${params.toString()}` : '';
    const response = await fetch(`${API_BASE_URL}/orders/admin/stats/summary${query}`, {
      headers: getAuthHeaders()
    });
    return response.json();
  }
};
```

---

## ⚠️ Error Handling

All endpoints return consistent error responses:

```json
{
  "success": false,
  "message": "Error description here"
}
```

**HTTP Status Codes:**

| Code | Description |
|------|-------------|
| 200 | Success |
| 400 | Bad Request (validation error) |
| 401 | Unauthorized (invalid/missing token) |
| 403 | Forbidden (not admin) |
| 404 | Not Found |
| 500 | Server Error |

---

## 📝 Notes for Frontend Implementation

1. **Token Storage:** Store JWT token securely (localStorage or httpOnly cookie)
2. **Token Refresh:** Implement token refresh logic before expiry
3. **Error Handling:** Always handle API errors gracefully
4. **Loading States:** Show loading indicators during API calls
5. **Optimistic Updates:** Consider optimistic UI updates for better UX
6. **Real-time Updates:** Consider WebSocket for real-time order updates

---

## 🔗 Related Endpoints

- **Customer Orders:** `GET /api/v1/orders` - Customer's own orders
- **Checkout:** `POST /api/v1/checkout/create-session` - Create order
- **Products:** `GET /api/v1/products` - Product listing
- **Categories:** `GET /api/v1/categories` - Category listing
