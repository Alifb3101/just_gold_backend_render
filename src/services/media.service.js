/**
 * Media Service - Unified URL resolver for Cloudinary and ImageKit
 * Supports safe migration from Cloudinary to ImageKit + S3
 */

// Provider configurations
const providers = {
  cloudinary: process.env.CLOUDINARY_BASE_URL || process.env.MEDIA_BASE_URL || "https://res.cloudinary.com/dvagrhc2w/image/upload",
  imagekit: process.env.IMAGEKIT_URL_ENDPOINT || "https://ik.imagekit.io/dvagrhc2w"
};

// Cloudinary transformation presets (legacy support)
const TRANSFORMATIONS = {
  thumbnail: "w_300,f_auto,q_auto",
  product: "w_800,f_auto,q_auto",
  zoom: "w_1400,f_auto,q_auto",
  card: "w_500,f_auto,q_auto",
  preview: "w_200,f_auto,q_75",
};

/**
 * Get media URL based on provider and size parameters
 * Supports both Cloudinary (legacy) and ImageKit (new) seamlessly
 * @param {string|Object} keyOrObject - Media key or {key, provider, size}
 * @param {string} [size] - Size preset ('thumbnail', 'product', 'zoom', 'card', 'preview')
 * @param {string} [provider] - Provider ('cloudinary' or 'imagekit')
 * @returns {string|null} Full media URL or null if no key
 */
const getMediaUrl = (keyOrObject, size = 'product', provider = 'cloudinary') => {
  // Handle object parameter
  if (typeof keyOrObject === 'object' && keyOrObject !== null) {
    const { key, size: objSize, provider: objProvider } = keyOrObject;
    return getMediaUrl(key, objSize || 'product', objProvider || 'cloudinary');
  }

  const key = keyOrObject;
  if (!key) return null;

  // LEGACY: Cloudinary provider
  if (provider === 'cloudinary') {
    // If key is already a full URL, return as-is
    if (key.startsWith('http')) {
      return key;
    }
    
    const base = providers.cloudinary;
    const transformation = TRANSFORMATIONS[size] || null;
    const prefix = base.endsWith('/') ? base : `${base}/`;

    if (!base) {
      return `/${key}`;
    }

    if (!transformation) {
      return `${prefix}${key}`;
    }

    return `${prefix}${transformation}/${key}`;
  }

  // MODERN: ImageKit provider
  if (provider === 'imagekit') {
    const baseUrl = providers.imagekit;
    
    // Build ImageKit transformation parameters based on size
    let transformation = '';
    
    if (size === 'thumbnail') {
      transformation = 'w-300,q-80';
    } else if (size === 'product') {
      transformation = 'w-800,q-80';
    } else if (size === 'zoom') {
      transformation = 'w-1400,q-90';
    } else if (size === 'card') {
      transformation = 'w-500,q-80';
    } else if (size === 'preview') {
      transformation = 'w-200,q-75';
    }

    // Return URL with or without transformation
    if (!transformation) {
      return `${baseUrl}/${key}`;
    }
    return `${baseUrl}/${key}?tr=${transformation}`;
  }

  // Fallback: return key as-is if provider unknown
  return key;
};

/**
 * Resolve media URL with fallback to old URLs
 * @param {string} directUrl - Direct/old URL from database
 * @param {string} mediaKey - Media key from database
 * @param {string} mediaProvider - Provider (cloudinary/imagekit)
 * @param {string} size - Size parameter
 * @returns {string|null}
 */
const resolveMediaUrl = (directUrl, mediaKey, mediaProvider, size = 'product') => {
  // If we have media_key and media_provider, use them
  if (mediaKey && mediaProvider) {
    return getMediaUrl(mediaKey, size, mediaProvider);
  }

  // Fallback to direct URL (old system)
  if (directUrl) {
    return directUrl;
  }

  return null;
};

/**
 * Batch resolve URLs for multiple records
 * @param {Array} records - Array of objects with image data
 * @param {Array} imageFields - Array of field names to resolve
 * @returns {Array} Records with resolved URLs
 */
const resolveMediaBatch = (records, imageFields = []) => {
  if (!records || !Array.isArray(records)) {
    return records;
  }

  return records.map(record => {
    if (!record) return record;

    // Resolve each image field
    imageFields.forEach(fieldName => {
      const keyFieldName = `${fieldName}_key`;
      const providerFieldName = 'media_provider';
      
      if (record[keyFieldName]) {
        record[fieldName] = resolveMediaUrl(
          record[fieldName],
          record[keyFieldName],
          record[providerFieldName] || 'cloudinary',
          getSizeFromFieldName(fieldName)
        );
      }
    });

    return record;
  });
};

/**
 * Infer size parameter from field name
 * @param {string} fieldName - Field name
 * @returns {string|null}
 */
const getSizeFromFieldName = (fieldName) => {
  if (fieldName.includes('thumbnail')) return 'thumbnail';
  if (fieldName.includes('preview')) return 'preview';
  if (fieldName.includes('card')) return 'card';
  if (fieldName.includes('zoom') || fieldName.includes('large')) return 'zoom';
  if (fieldName.includes('product') || fieldName.includes('main')) return 'product';
  return 'product';
};

/**
 * Check provider type
 */
const isCloudinary = (record) => !record.media_provider || record.media_provider === 'cloudinary';
const isImageKit = (record) => record.media_provider === 'imagekit';

module.exports = {
  getMediaUrl,
  resolveMediaUrl,
  resolveMediaBatch,
  getSizeFromFieldName,
  isCloudinary,
  isImageKit,
  providers
};
