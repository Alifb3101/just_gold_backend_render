const buildImageKitVariants = (imageKey, mediaProvider = "imagekit") => {
  if (!imageKey || typeof imageKey !== "string") return null;

  const provider = String(mediaProvider || "cloudinary").toLowerCase();

  if (provider === "imagekit") {
    const endpoint = (process.env.IMAGEKIT_URL_ENDPOINT || "").replace(/\/$/, "");
    if (!endpoint) return null;

    const base = `${endpoint}/${imageKey}`;
    const build = (tr) => `${base}?tr=${tr}`;

    return {
      original: base,
      thumbnail: build("w-300,f-auto,q-auto"),
      medium: build("w-800,f-auto,q-auto"),
      large: build("w-1400,f-auto,q-auto"),
    };
  }

  const cloudinaryBase = (process.env.CLOUDINARY_BASE_URL || "https://res.cloudinary.com/dvagrhc2w/image/upload").replace(/\/$/, "");
  return {
    original: `${cloudinaryBase}/${imageKey}`,
    thumbnail: `${cloudinaryBase}/w_300,f_auto,q_auto/${imageKey}`,
    medium: `${cloudinaryBase}/w_800,f_auto,q_auto/${imageKey}`,
    large: `${cloudinaryBase}/w_1400,f_auto,q_auto/${imageKey}`,
  };
};

module.exports = {
  buildImageKitVariants,
};