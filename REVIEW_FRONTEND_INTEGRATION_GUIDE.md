# Review API - Frontend Integration Guide

**For**: Frontend Development Team  
**Purpose**: Implement review functionality in frontend  
**Status**: ✅ Ready for Integration  

---

## 🎯 Overview

Your backend now has a complete review system. This guide helps you integrate it into your frontend.

### What's Available

✅ Get product reviews with pagination  
✅ Submit reviews with images  
✅ Edit/delete user's own reviews  
✅ Mark reviews helpful/unhelpful  
✅ Show review statistics  
✅ Verified purchase badges  

---

## 📦 API Base URL

```javascript
const API_BASE = 'https://just-gold-backend-render.onrender.com/api/v1';
// OR for development:
const API_BASE = 'http://localhost:5000/api/v1';
```

---

## 🔐 Authentication

Get JWT token from login:

```javascript
// After user login
const loginResponse = await fetch(`${API_BASE}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password })
});

const { data } = await loginResponse.json();
const token = data.accessToken; // Save this in localStorage

localStorage.setItem('token', token);
```

Use token in authenticated requests:

```javascript
const token = localStorage.getItem('token');

const response = await fetch(url, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify(data)
});
```

---

## 📖 Display Product Reviews

### 1. Get Reviews List

```javascript
async function getProductReviews(productId, page = 1, sortBy = 'recent') {
  try {
    const response = await fetch(
      `${API_BASE}/products/${productId}/reviews?page=${page}&limit=10&sortBy=${sortBy}`
    );
    const { data } = await response.json();
    
    return {
      reviews: data.reviews,           // Array of review objects
      stats: data.stats,               // Product rating stats
      pagination: data.pagination      // Page info
    };
  } catch (error) {
    console.error('Failed to fetch reviews:', error);
  }
}

// Usage:
const { reviews, stats } = await getProductReviews(productId);

// Display stats
{/* Example React component */}
<div className="rating-stats">
  <h3>{stats.averageRating} ⭐</h3>
  <p>{stats.totalReviews} reviews</p>
  
  {/* Rating distribution */}
  {Object.entries(stats.distribution).map(([rating, count]) => (
    <div key={rating} className="rating-bar">
      <span>{rating}★</span>
      <div className="bar" style={{width: `${(count/stats.totalReviews)*100}%`}}/>
      <span>{count}</span>
    </div>
  ))}
</div>

// Display reviews
{reviews.map(review => (
  <ReviewCard key={review.id} review={review} />
))}
```

### 2. Review Card Component

```javascript
function ReviewCard({ review, onEdit, onDelete, onHelpful }) {
  return (
    <div className="review-card">
      {/* Header */}
      <div className="review-header">
        <div className="user-info">
          <strong>{review.userName}</strong>
          {review.verifiedPurchase && <span className="badge">✓ Verified</span>}
        </div>
        <div className="rating">
          {'⭐'.repeat(review.rating)}
        </div>
      </div>
      
      {/* Title & Comment */}
      <h4>{review.title}</h4>
      <p>{review.comment}</p>
      
      {/* Images */}
      {review.images && review.images.length > 0 && (
        <div className="review-images">
          {review.images.map((img, idx) => (
            <img 
              key={idx} 
              src={img.image_url} 
              alt="Review" 
              className="review-img"
            />
          ))}
        </div>
      )}
      
      {/* Metadata */}
      <div className="review-meta">
        <small>{new Date(review.createdAt).toLocaleDateString()}</small>
        
        <button onClick={() => onHelpful(review.id, true)}>
          👍 Helpful ({review.helpfulCount})
        </button>
        <button onClick={() => onHelpful(review.id, false)}>
          👎 ({review.unhelpfulCount})
        </button>
        
        {/* Edit/Delete - owner only */}
        {isOwner && (
          <>
            <button onClick={() => onEdit(review.id)}>Edit</button>
            <button onClick={() => onDelete(review.id)}>Delete</button>
          </>
        )}
      </div>
    </div>
  );
}
```

### 3. Sort Options

```javascript
const SORT_OPTIONS = [
  { value: 'recent', label: 'Newest First' },
  { value: 'helpful', label: 'Most Helpful' },
  { value: 'rating-high', label: '⭐ Highest Rating' },
  { value: 'rating-low', label: 'Lowest Rating' }
];

{/* Dropdown */}
<select onChange={(e) => setSort(e.target.value)}>
  {SORT_OPTIONS.map(opt => (
    <option key={opt.value} value={opt.value}>
      {opt.label}
    </option>
  ))}
</select>
```

---

## ✍️ Submit Review

### 1. Review Form Component

```javascript
function ReviewForm({ productId, onSuccess }) {
  const [rating, setRating] = useState(5);
  const [title, setTitle] = useState('');
  const [comment, setComment] = useState('');
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(false);

  const handleImageChange = (e) => {
    const files = Array.from(e.target.files);
    if (files.length + images.length > 5) {
      alert('Max 5 images allowed');
      return;
    }
    setImages([...images, ...files]);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      const formData = new FormData();
      formData.append('rating', rating);
      formData.append('title', title);
      formData.append('comment', comment);
      
      // Add images
      images.forEach(img => {
        formData.append('images', img);
      });

      const token = localStorage.getItem('token');
      const response = await fetch(
        `${API_BASE}/products/${productId}/reviews`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`
          },
          body: formData
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error);
      }

      const { data } = await response.json();
      onSuccess(data); // Refresh reviews
      
      // Reset form
      setRating(5);
      setTitle('');
      setComment('');
      setImages([]);
      
    } catch (error) {
      alert(`Error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="review-form">
      {/* Rating */}
      <div className="form-group">
        <label>Rating</label>
        <div className="rating-selector">
          {[1,2,3,4,5].map(r => (
            <button
              key={r}
              type="button"
              className={`star ${r <= rating ? 'active' : ''}`}
              onClick={() => setRating(r)}
            >
              ⭐
            </button>
          ))}
        </div>
        <span>{rating} out of 5</span>
      </div>

      {/* Title */}
      <div className="form-group">
        <label>Title *</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={255}
          placeholder="Summary of your experience"
          required
        />
        <small>{title.length}/255</small>
      </div>

      {/* Comment */}
      <div className="form-group">
        <label>Comment</label>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          maxLength={2000}
          placeholder="Tell others about your experience (optional)"
          rows={4}
        />
        <small>{comment.length}/2000</small>
      </div>

      {/* Images */}
      <div className="form-group">
        <label>Images (optional, max 5)</label>
        <input
          type="file"
          multiple
          accept="image/*"
          onChange={handleImageChange}
          disabled={images.length >= 5}
        />
        
        {/* Preview */}
        <div className="image-preview">
          {images.map((img, idx) => (
            <div key={idx} className="preview-item">
              <img src={URL.createObjectURL(img)} alt="Preview" />
              <button
                type="button"
                onClick={() => setImages(images.filter((_, i) => i !== idx))}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        
        <small>{images.length}/5 images</small>
      </div>

      <button type="submit" disabled={loading}>
        {loading ? 'Submitting...' : 'Submit Review'}
      </button>
    </form>
  );
}
```

### 2. Error Handling

```javascript
async function submitReview(productId, reviewData) {
  try {
    const response = await fetch(
      `${API_BASE}/products/${productId}/reviews`,
      {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData
      }
    );

    if (response.status === 401) {
      // Not logged in
      redirectToLogin();
      return;
    }

    if (response.status === 409) {
      // Already reviewed
      alert('You have already reviewed this product');
      return;
    }

    if (response.status === 400) {
      const error = await response.json();
      // Show specific validation error
      alert(`Validation error: ${error.error}`);
      return;
    }

    if (!response.ok) {
      throw new Error('Failed to submit review');
    }

    return await response.json();

  } catch (error) {
    console.error('Error:', error);
    alert('Failed to submit review. Please try again.');
  }
}
```

---

## ✏️ Edit Review

```javascript
async function updateReview(reviewId, updates) {
  const token = localStorage.getItem('token');
  
  const response = await fetch(
    `${API_BASE}/reviews/${reviewId}`,
    {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(updates) // { rating, title, comment }
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error);
  }

  return await response.json();
}

// Usage
const updates = {
  rating: 4,
  title: 'Updated: Changed my mind',
  comment: 'After testing more, I found...'
};

await updateReview(reviewId, updates);
```

---

## 🗑️ Delete Review

```javascript
async function deleteReview(reviewId) {
  if (!confirm('Are you sure you want to delete this review?')) {
    return;
  }

  const token = localStorage.getItem('token');
  
  const response = await fetch(
    `${API_BASE}/reviews/${reviewId}`,
    {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    }
  );

  if (!response.ok) {
    throw new Error('Failed to delete review');
  }

  return await response.json();
}
```

---

## 👍 Mark Helpful

```javascript
async function markHelpful(reviewId, isHelpful = true) {
  const response = await fetch(
    `${API_BASE}/reviews/${reviewId}/helpful`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ helpful: isHelpful })
    }
  );

  if (!response.ok) {
    throw new Error('Failed to mark helpful');
  }

  const { data } = await response.json();
  return {
    helpfulCount: data.helpful_count,
    unhelpfulCount: data.unhelpful_count
  };
}
```

---

## 🧩 Complete Integration Example

### React Component with All Features

```javascript
import { useState, useEffect } from 'react';

export default function ProductReviews({ productId }) {
  const [reviews, setReviews] = useState([]);
  const [stats, setStats] = useState(null);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState('recent');
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  const API_BASE = 'https://just-gold-backend-render.onrender.com/api/v1';
  const token = localStorage.getItem('token');

  useEffect(() => {
    setIsLoggedIn(!!token);
  }, [token]);

  // Load reviews
  useEffect(() => {
    loadReviews();
  }, [productId, page, sort]);

  const loadReviews = async () => {
    try {
      setLoading(true);
      const response = await fetch(
        `${API_BASE}/products/${productId}/reviews?page=${page}&limit=10&sortBy=${sort}`
      );
      
      if (!response.ok) throw new Error('Failed to load reviews');
      
      const { data } = await response.json();
      setReviews(data.reviews);
      setStats(data.stats);
      
    } catch (error) {
      console.error('Error:', error);
      alert('Failed to load reviews');
    } finally {
      setLoading(false);
    }
  };

  const handleReviewSubmitted = async (newReview) => {
    setShowForm(false);
    await loadReviews(); // Refresh
    alert('Review submitted successfully!');
  };

  const handleDelete = async (reviewId) => {
    if (!confirm('Delete this review?')) return;
    
    try {
      await fetch(`${API_BASE}/reviews/${reviewId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      await loadReviews();
    } catch (error) {
      alert('Failed to delete review');
    }
  };

  const handleHelpful = async (reviewId, isHelpful) => {
    try {
      const response = await fetch(`${API_BASE}/reviews/${reviewId}/helpful`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ helpful: isHelpful })
      });
      
      await loadReviews();
    } catch (error) {
      console.error('Error:', error);
    }
  };

  return (
    <div className="product-reviews">
      {/* Stats */}
      {stats && (
        <div className="rating-stats">
          <h2>{stats.averageRating} ⭐</h2>
          <p>{stats.totalReviews} reviews</p>
        </div>
      )}

      {/* Write Review Button */}
      {isLoggedIn && (
        <button onClick={() => setShowForm(!showForm)}>
          {showForm ? 'Cancel' : 'Write a Review'}
        </button>
      )}

      {!isLoggedIn && (
        <p>
          <a href="/login">Log in</a> to write a review
        </p>
      )}

      {/* Review Form */}
      {showForm && isLoggedIn && (
        <ReviewForm productId={productId} onSuccess={handleReviewSubmitted} />
      )}

      {/* Sort */}
      <select value={sort} onChange={(e) => setSort(e.target.value)}>
        <option value="recent">Newest First</option>
        <option value="helpful">Most Helpful</option>
        <option value="rating-high">Highest Rating</option>
        <option value="rating-low">Lowest Rating</option>
      </select>

      {/* Reviews */}
      {loading ? (
        <p>Loading...</p>
      ) : reviews.length === 0 ? (
        <p>No reviews yet</p>
      ) : (
        reviews.map(review => (
          <ReviewCard
            key={review.id}
            review={review}
            onDelete={handleDelete}
            onHelpful={handleHelpful}
          />
        ))
      )}

      {/* Pagination */}
      <div className="pagination">
        <button 
          onClick={() => setPage(p => Math.max(1, p - 1))}
          disabled={page === 1}
        >
          Previous
        </button>
        <span>Page {page}</span>
        <button onClick={() => setPage(p => p + 1)}>
          Next
        </button>
      </div>
    </div>
  );
}
```

---

## 🔗 Related Documentation

- **Complete API Reference**: [`REVIEW_API_DOCUMENTATION.md`](./REVIEW_API_DOCUMENTATION.md)
- **Quick Reference**: [`REVIEW_API_QUICK_REFERENCE.md`](./REVIEW_API_QUICK_REFERENCE.md)
- **Backend Implementation**: [`REVIEW_IMPLEMENTATION_SUMMARY.md`](./REVIEW_IMPLEMENTATION_SUMMARY.md)

---

## ✅ Testing Checklist

- [ ] Review form submits without images
- [ ] Review form submits with images
- [ ] Review submission shows loading state
- [ ] Reviews display with correct user info
- [ ] Verified purchase badge shows
- [ ] Pagination works
- [ ] Sorting works
- [ ] Edit button appears for own review
- [ ] Edit functionality works
- [ ] Delete button appears for own review
- [ ] Delete asks for confirmation
- [ ] Helpful/unhelpful buttons work
- [ ] Error messages display properly
- [ ] Login redirect works

---

## 🐛 Troubleshooting

### CORS Error
**Problem**: `Access to fetch blocked by CORS policy`  
**Solution**: Make sure backend has FRONTEND_URL set to your actual frontend URL

### 401 Unauthorized
**Problem**: Getting 401 on review submission  
**Solution**: Check token is properly stored and included in Authorization header

### 409 Duplicate Review
**Problem**: Can't submit review, says already reviewed  
**Solution**: User can only have one review per product. Delete old one first.

### Image Upload Fails
**Problem**: Image not uploading  
**Solution**: Check file size (max 100MB) and format (JPEG, PNG, GIF, WebP)

---

**Status**: ✅ Ready for Frontend Integration  
**Backend API**: Fully implemented and tested  
**Support**: Refer to documentation files as needed
