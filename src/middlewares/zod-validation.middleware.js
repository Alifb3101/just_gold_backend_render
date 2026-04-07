const validateBody = (schema) => {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      const firstIssue = result.error.issues?.[0];
      return res.status(400).json({
        success: false,
        message: firstIssue?.message || "Invalid request body",
      });
    }

    req.body = result.data;
    return next();
  };
};

module.exports = {
  validateBody,
};
