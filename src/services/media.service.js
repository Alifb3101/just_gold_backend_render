/* =========================================================
   MEDIA SERVICE
   - Builds media URL from stored key
========================================================= */

// Cloudinary transformation presets for responsive sizes
const TRANSFORMATIONS = {
  thumbnail: "w_300,f_auto,q_auto",
  product: "w_800,f_auto,q_auto",
  zoom: "w_1400,f_auto,q_auto",
};

const getMediaUrl = (key, size = "product") => {
  if (!key) return null;

  const base = process.env.MEDIA_BASE_URL || "";
  const hasSizeArgument = arguments.length >= 2;
  const transformation = hasSizeArgument ? TRANSFORMATIONS[size] : null;
  const prefix = base.endsWith("/") ? base : `${base}/`;

  if (!base) {
    return `/${key}`;
  }

  if (!transformation) {
    return `${prefix}${key}`;
  }

  return `${prefix}${transformation}/${key}`;
};

module.exports = { getMediaUrl };
