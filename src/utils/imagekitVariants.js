const { getMediaUrl } = require("../services/media.service");

const buildImageKitVariants = (imageKey, mediaProvider = "imagekit", directUrl = null) => {
  const provider = String(mediaProvider || "cloudinary").toLowerCase();
  const keyOrUrl = imageKey || directUrl;

  if (!keyOrUrl || typeof keyOrUrl !== "string") return null;

  if (provider === "imagekit") {
    const endpoint = (process.env.IMAGEKIT_URL_ENDPOINT || "").replace(/\/$/, "");
    if (!endpoint || !imageKey) return null;

    const base = `${endpoint}/${imageKey}`;
    const build = (tr) => `${base}?tr=${tr}`;

    return {
      original: base,
      thumbnail: build("w-300,f-auto,q-auto"),
      medium: build("w-800,f-auto,q-auto"),
      large: build("w-1400,f-auto,q-auto"),
    };
  }

  // Cloudinary and any unknown provider fallback use legacy transformation format.
  return {
    original: getMediaUrl(keyOrUrl, null, "cloudinary"),
    thumbnail: getMediaUrl(keyOrUrl, "thumbnail", "cloudinary"),
    medium: getMediaUrl(keyOrUrl, "product", "cloudinary"),
    large: getMediaUrl(keyOrUrl, "zoom", "cloudinary"),
  };
};

module.exports = {
  buildImageKitVariants,
};