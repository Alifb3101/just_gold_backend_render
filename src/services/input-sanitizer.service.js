const stripHtmlTags = (value) => value.replace(/<[^>]*>/g, " ");

const sanitizeText = (value, maxLength = 5000) => {
  if (typeof value !== "string") return "";

  return stripHtmlTags(value)
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
};

const sanitizeEmail = (value) => {
  if (typeof value !== "string") return "";
  return sanitizeText(value, 320).toLowerCase();
};

module.exports = {
  sanitizeText,
  sanitizeEmail,
};
