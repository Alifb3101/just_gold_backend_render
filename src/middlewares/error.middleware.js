module.exports = (err, req, res, next) => {
  console.error("[error]", {
    path: req.originalUrl,
    method: req.method,
    message: err?.message,
    code: err?.code,
    statusCode: err?.statusCode || err?.status,
  });

  const statusCode = err?.statusCode || err?.status || 500;
  const code = err?.code || "INTERNAL_ERROR";

  if (err && (err.code === "LIMIT_FILE_SIZE" || err.message === "Unsupported file type")) {
    return res.status(400).json({
      success: false,
      message: err.message,
      code: "FILE_UPLOAD_ERROR",
    });
  }

  const message =
    statusCode >= 500 && process.env.NODE_ENV !== "development"
      ? "Internal Server Error"
      : err?.message || "Internal Server Error";

  res.status(statusCode).json({
    success: false,
    message,
    code,
  });
};
