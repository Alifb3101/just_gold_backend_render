const ImageKit = require("@imagekit/nodejs").default;

/* =========================================================
   IMAGEKIT CONFIGURATION
   - Cloud-based image and video delivery
   - Automatic optimization and transformations
   - S3 backend with ImageKit CDN
========================================================= */

const imageKit = new ImageKit({
  publicKey: process.env.IMAGEKIT_PUBLIC_KEY || "",
  privateKey: process.env.IMAGEKIT_PRIVATE_KEY || "",
  urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT || "https://ik.imagekit.io/dvagrhc2w",
});

module.exports = imageKit;
