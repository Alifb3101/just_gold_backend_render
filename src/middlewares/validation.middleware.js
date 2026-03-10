const { ApiError } = require("../utils/apiError");

const validate = (schema, source = "body") => (req, _res, next) => {
  const payload = req[source] || {};
  const { error, value } = schema.validate(payload, {
    abortEarly: false,
    allowUnknown: false,
    stripUnknown: true,
  });

  if (error) {
    return next(
      new ApiError(
        400,
        error.details.map((item) => item.message).join(", "),
        "VALIDATION_ERROR"
      )
    );
  }

  req[source] = value;
  return next();
};

module.exports = { validate };
