const pool = require("../config/db");

/* =========================================================
   SETTINGS CONTROLLER
   - Manages global application settings
   - Media provider selection, feature flags, etc.
========================================================= */

/**
 * Get current media provider setting
 * GET /api/v1/settings/media-provider
 */
const getMediaProvider = async (req, res) => {
  try {
    // Get from environment (server-level setting)
    const provider = process.env.MEDIA_PROVIDER || 'cloudinary';
    
    // Could also store in database for persistence
    res.json({
      success: true,
      provider: provider,
      availableProviders: ['cloudinary', 'imagekit'],
      description: 'Current media upload provider'
    });
  } catch (error) {
    console.error('[SETTINGS] Error getting media provider:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get media provider setting',
      error: error.message
    });
  }
};

/**
 * Get all settings
 * GET /api/v1/settings
 */
const getSettings = async (req, res) => {
  try {
    const settings = {
      mediaProvider: process.env.MEDIA_PROVIDER || 'cloudinary',
      imagekitEnabled: !!(process.env.IMAGEKIT_PUBLIC_KEY && process.env.IMAGEKIT_PRIVATE_KEY),
      cloudinaryEnabled: !!(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY),
      environment: process.env.NODE_ENV || 'development',
    };
    
    res.json({
      success: true,
      settings
    });
  } catch (error) {
    console.error('[SETTINGS] Error getting settings:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get settings',
      error: error.message
    });
  }
};

module.exports = {
  getMediaProvider,
  getSettings,
};
