const {
  fetchSearchSuggestions,
  fetchTrendingQueries,
} = require("../services/search.service");

exports.getSuggestions = async (req, res, next) => {
  try {
    const suggestions = await fetchSearchSuggestions(req.query.q);
    res.json({ suggestions });
  } catch (err) {
    next(err);
  }
};

exports.getTrending = async (req, res, next) => {
  try {
    const trending = await fetchTrendingQueries();
    res.json({ trending });
  } catch (err) {
    next(err);
  }
};
