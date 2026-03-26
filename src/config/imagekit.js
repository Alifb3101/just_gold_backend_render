const ImageKit = require("@imagekit/nodejs");

/* =========================================================
   IMAGEKIT CONFIGURATION
   - Cloud-based image and video delivery
   - Automatic optimization and transformations
   - S3 backend with ImageKit CDN
========================================================= */

// Create ImageKit instance for file uploads to ImageKit
const imageKitInstance = new ImageKit({
  publicKey: process.env.IMAGEKIT_PUBLIC_KEY || "",
  privateKey: process.env.IMAGEKIT_PRIVATE_KEY || "",
  urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT || "https://ik.imagekit.io/dvagrhc2w",
});

// The instance should have the upload method from @imagekit/nodejs v7+
// If not available directly, we'll use the REST API approach
module.exports = imageKitInstance;
