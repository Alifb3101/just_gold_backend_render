const SITEMAP_URL = "https://www.justgoldcosmetics.com/sitemap.xml";
const GOOGLE_PING_URL = `https://www.google.com/ping?sitemap=${encodeURIComponent(SITEMAP_URL)}`;

const pingGoogleSitemap = async () => {
  try {
    await fetch(GOOGLE_PING_URL, { method: "GET" });
  } catch {
    // Intentionally silent to avoid affecting write APIs.
  }
};

module.exports = {
  pingGoogleSitemap,
};
