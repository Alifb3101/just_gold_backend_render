const router = require("express").Router();
const multer = require("multer");
const controller = require("../controllers/product.controller");

/* =========================================================
   CLOUDINARY UPLOAD CONFIGURATION
   - All files now stored in Cloudinary
   - Auto-optimized for 1000+ products
   - Scalable cloud storage solution
========================================================= */

const MAX_VARIANTS = 20;

const buildVariantFields = () => {
  const fields = [];
  for (let i = 0; i < MAX_VARIANTS; i++) {
    fields.push({ name: `color_${i}`, maxCount: 1 });
    fields.push({ name: `color_secondary_${i}`, maxCount: 1 });
    fields.push({ name: `color_panel_image_${i}`, maxCount: 1 });
    fields.push({ name: `variant_main_image_${i}`, maxCount: 1 });
    fields.push({ name: `variant_secondary_image_${i}`, maxCount: 1 });
  }
  return fields;
};

const uploadFields = [
  { name: "image", maxCount: 1 },
  { name: "gallery", maxCount: 6 },
  { name: "media", maxCount: 6 },
  { name: "video", maxCount: 1 },
  ...buildVariantFields(),
];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB max
    files: 80,
  },
}).fields(uploadFields);


/* =========================================================
   FILE VALIDATION HELPERS
========================================================= */

const allowedImageMimes = [
  "image/jpeg",
  "image/png",
  "image/jpg",
  "image/gif",
  "image/webp",
];

const allowedVideoMimes = [
  "video/mp4",
  "video/quicktime", // mov
  "video/x-msvideo", // avi
  "video/x-matroska", // mkv
  "video/webm",
];

const validateFileForCloudinary = (fieldName, file) => {
  if (!file || !file.buffer || file.buffer.length === 0) {
    return "Uploaded field did not include file data. Make sure you selected 'File' and picked an actual image/video.";
  }

  const mimetype = file.mimetype || "";

  if (fieldName === "video") {
    if (!allowedVideoMimes.includes(mimetype)) {
      return `Invalid video type (${mimetype || "unknown"}). Supported: MP4, MOV, AVI, MKV, WebM.`;
    }
  } else {
    if (!allowedImageMimes.includes(mimetype)) {
      return `Invalid image type (${mimetype || "unknown"}). Supported: JPEG, PNG, GIF, WebP.`;
    }
  }

  return null;
};

/* =========================================================
   UPLOAD HANDLER - DUAL PROVIDER SUPPORT
   - Supports Cloudinary (legacy) and ImageKit (new)
   - Route based on MEDIA_PROVIDER environment variable OR request override
   - Priority: request param > request header > env var
   - MEDIA_PROVIDER=imagekit → ImageKit uploads
   - MEDIA_PROVIDER=cloudinary (or unset) → Cloudinary uploads
========================================================= */

const getMediaProvider = (req = null) => {
  let provider = process.env.MEDIA_PROVIDER || 'cloudinary';
  
  // Allow override from request (highest priority)
  if (req) {
    // Check query parameter
    if (req.query?.mediaProvider) {
      provider = req.query.mediaProvider;
    }
    // Check request body
    else if (req.body?.mediaProvider) {
      provider = req.body.mediaProvider;
    }
    // Check header
    else if (req.headers['x-media-provider']) {
      provider = req.headers['x-media-provider'];
    }
  }
  
  const normalized = provider.toLowerCase();
  console.log(`[MEDIA PROVIDER] Using: ${normalized}`, {
    fromEnv: process.env.MEDIA_PROVIDER,
    fromRequest: req ? (req.query?.mediaProvider || req.body?.mediaProvider || req.headers['x-media-provider']) : null,
  });
  return normalized;
};

const uploadHandler = (req, res, next) => {
  upload(req, res, async (err) => {
    const provider = getMediaProvider(req);
    console.log("[UPLOAD DEBUG] Request received", {
      method: req.method,
      path: req.path,
      files: req.files ? Object.keys(req.files) : "NO FILES",
      hasAuth: !!req.headers.authorization,
      provider: provider,
    });

    if (err) {
      console.error("[UPLOAD ERROR] Multer error:", err);
      if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(400).json({
            message: "File too large. Max 10MB for images, 100MB for videos.",
          });
        }
        if (err.code === "LIMIT_FILE_COUNT") {
          return res.status(400).json({
            message: "Too many files uploaded.",
          });
        }
      }
      return res.status(400).json({
        message: err.message || "File upload error",
      });
    }

    // Route to appropriate upload provider
    if (req.files && Object.keys(req.files).length > 0) {
      // Use provider already determined at top of handler
      if (provider === 'imagekit') {
        return uploadToImageKit(req, res, next);
      } else {
        return uploadToCloudinary(req, res, next);
      }
    } else {
      next();
    }
  });
};

/* =========================================================
   CLOUDINARY UPLOAD FUNCTION
========================================================= */
const uploadToCloudinary = async (req, res, next) => {
  try {
    console.log("[UPLOAD DEBUG] Processing files to Cloudinary:", Object.keys(req.files));
    const cloudinary = require("cloudinary").v2;
    const uploadPromises = [];

    for (const fieldName in req.files) {
      const files = req.files[fieldName];
      
      for (const file of files) {
        const validationError = validateFileForCloudinary(fieldName, file);
        if (validationError) {
          return res.status(400).json({
            message: validationError,
            field: fieldName,
            filename: file.originalname || "unknown",
          });
        }

        // Determine folder based on field type
        let folder = "just_gold/products/images";
        let resourceType = "image";

        if (fieldName === "video") {
          folder = "just_gold/products/videos";
          resourceType = "video";
        } else if (
          fieldName.startsWith("color_") ||
          fieldName.startsWith("color_secondary_") ||
          fieldName.startsWith("variant_main_image_") ||
          fieldName.startsWith("variant_secondary_image_")
        ) {
          folder = "just_gold/products/variants";
        }

        // Upload to Cloudinary
        const uploadPromise = new Promise((resolve, reject) => {
          const uploadStream = cloudinary.uploader.upload_stream(
            {
              folder: folder,
              resource_type: resourceType,
              transformation: resourceType === "image" ? [
                { width: 1500, height: 1500, crop: "limit" },
                { quality: "auto:best" },
                { fetch_format: "auto" },
              ] : [
                { quality: "auto" },
              ],
            },
            (error, result) => {
              if (error) {
                error._fieldName = fieldName;
                error._filename = file.originalname || "unknown";
                error._mimetype = file.mimetype;
                reject(error);
              } else {
                // Replace file object with Cloudinary result
                file.cloudinary = result;
                file.path = result.secure_url;
                file.filename = result.public_id.split("/").pop();
                resolve(result);
              }
            }
          );
          
          uploadStream.end(file.buffer);
        });

        uploadPromises.push(uploadPromise);
      }
    }

    await Promise.all(uploadPromises);
    next();
  } catch (error) {
    console.error("Cloudinary upload error:", {
      message: error.message,
      http_code: error.http_code,
      field: error._fieldName,
      filename: error._filename,
      mimetype: error._mimetype,
    });
    const statusCode = error.http_code === 400 ? 400 : 500;
    return res.status(statusCode).json({
      message: "Cloudinary rejected the uploaded file. Ensure you're sending a valid image/video file via form-data.",
      details: {
        field: error._fieldName || null,
        filename: error._filename || null,
        mimetype: error._mimetype || null,
        cloudinary_error: error.message,
        http_code: error.http_code || null,
      },
    });
  }
};

/* =========================================================
   IMAGEKIT UPLOAD FUNCTION (S3-backed)
========================================================= */
const uploadToImageKit = async (req, res, next) => {
  try {
    const { PutObjectCommand } = require("@aws-sdk/client-s3");
    const s3 = require("../config/s3");
    const endpoint = (process.env.IMAGEKIT_URL_ENDPOINT || "").replace(/\/$/, "");

    console.log("[UPLOAD DEBUG] Processing files to ImageKit (via S3):", Object.keys(req.files));

    const uploadPromises = [];

    for (const fieldName in req.files) {
      const files = req.files[fieldName];
      for (const file of files) {
        const validationError = validateFileForCloudinary(fieldName, file);
        if (validationError) {
          return res.status(400).json({
            message: validationError,
            field: fieldName,
            filename: file.originalname || "unknown",
          });
        }

        // Determine folder based on field type
        let folder = "just_gold/products/images";
        if (fieldName === "video") {
          folder = "just_gold/products/videos";
        } else if (
          fieldName.startsWith("color_") ||
          fieldName.startsWith("color_secondary_") ||
          fieldName.startsWith("variant_main_image_") ||
          fieldName.startsWith("variant_secondary_image_")
        ) {
          folder = "just_gold/products/variants";
        }

        const extFromMime = (file.mimetype && file.mimetype.split("/")[1]) || "bin";
        const unique = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const fileName = file.originalname || `${unique}.${extFromMime}`;
        const key = `${folder}/${fileName}`;

        const uploadPromise = s3.send(new PutObjectCommand({
          Bucket: process.env.S3_BUCKET,
          Key: key,
          Body: file.buffer,
          ContentType: file.mimetype,
        })).then(() => {
          console.log("[S3 UPLOAD] Success:", { key, folder });
          // Attach S3/ImageKit data to file for downstream handlers
          file.imagekitKey = key; // store key only
          file.path = endpoint ? `${endpoint}/${key}` : null; // CDN URL for response consumption
          file.filename = fileName;
          return { key };
        }).catch((error) => {
          console.error("[S3 UPLOAD] Error:", {
            fieldName,
            filename: file.originalname,
            error: error.message,
          });
          error._fieldName = fieldName;
          error._filename = file.originalname || "unknown";
          error._mimetype = file.mimetype;
          throw error;
        });

        uploadPromises.push(uploadPromise);
      }
    }

    await Promise.all(uploadPromises);
    console.log("[UPLOAD DEBUG] All files uploaded to S3 (ImageKit CDN) successfully");
    next();
  } catch (error) {
    const awsMeta = error?.$metadata || {};
    console.error("[S3 UPLOAD] Fatal error:", {
      message: error.message,
      code: error.name || error.code,
      field: error._fieldName,
      filename: error._filename,
      mimetype: error._mimetype,
      aws: awsMeta,
      stack: error.stack,
    });
    return res.status(500).json({
      message: "ImageKit/S3 upload failed. Ensure you're sending a valid image/video file via form-data.",
      details: {
        field: error._fieldName || null,
        filename: error._filename || null,
        mimetype: error._mimetype || null,
        imagekit_error: error.message,
        aws: awsMeta,
      },
    });
  }
};

/* -------- ROUTES -------- */

// Product CRUD (single resource)
router.post("/products", uploadHandler, controller.createProduct);
router.put("/products/:id", uploadHandler, controller.updateProduct);
router.post("/products/:id/upload", uploadHandler, controller.updateProduct);
router.delete("/products/:id", controller.deleteProduct);
router.get("/products/:id-:slug", controller.getProductDetail);
// Backward-compat: legacy singular route
router.get("/product/:id-:slug", controller.getProductDetail);

// Backward-compat: legacy singular CRUD endpoints
// JSON-only create (for admin panel) - no upload handler
router.post("/product", controller.createProduct);
// Form-data update (with images)
router.put("/product/:id", uploadHandler, controller.updateProduct);
router.delete("/product/:id", controller.deleteProduct);
router.get("/product", controller.getProducts);

// Product collection (list all)
router.get("/products", controller.getProducts);

module.exports = router;
