const {
  DEFAULT_LIMIT,
  normalizeLimit,
  normalizeSectionName,
  getSectionProducts,
} = require("../services/section.service");
const { getHomepageData } = require("../services/homepage.service");

exports.getSectionProducts = async (req, res, next) => {
  try {
    const sectionName = normalizeSectionName(req.params.sectionName);

    if (!sectionName) {
      return res.status(400).json({
        message: "Invalid sectionName. Use 2-50 lowercase chars: letters, numbers, _ or -",
      });
    }

    const limit = normalizeLimit(req.query.limit ?? DEFAULT_LIMIT);
    const payload = await getSectionProducts({ sectionName, limit });

    return res.json(payload);
  } catch (error) {
    if (error && error.status === 404) {
      return res.status(404).json({ message: "Section not found" });
    }
    return next(error);
  }
};

exports.getHomepage = async (req, res, next) => {
  try {
    const payload = await getHomepageData({
      rawLimit: req.query.limit,
    });

    return res.json({
      success: true,
      data: payload,
    });
  } catch (error) {
    return next(error);
  }
};
