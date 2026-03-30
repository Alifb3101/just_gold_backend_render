const buildImageKitVariants = (imageKey) => {
  if (!imageKey || typeof imageKey !== "string") return null;

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
};

module.exports = {
  buildImageKitVariants,
};