const CONFIG = require('../lib/Config');
const SheetsService = require('./SheetsService');

/**
 * Location Service
 * Handles GPS validation, geofence checking, and location utilities
 */
class LocationService {
  constructor() {
    this.sheets = SheetsService;
    this.accuracyThreshold = CONFIG.GPS_ACCURACY_THRESHOLD;
    this.maxAccuracyMismatch = CONFIG.GPS_MAX_ACCURACY_MISMATCH;
    this.retryAttempts = CONFIG.GPS_RETRY_ATTEMPTS;
  }

  /**
   * Validate GPS coordinates
   * @param {number} lat - Latitude
   * @param {number} lon - Longitude
   * @param {number} accuracy - Reported accuracy in meters
   * @returns {Object} Validation result
   */
  validateGPS(lat, lon, accuracy) {
    if (typeof lat !== 'number' || typeof lon !== 'number') {
      return { valid: false, error: 'Invalid coordinates' };
    }

    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      return { valid: false, error: 'Coordinates out of range' };
    }

    if (typeof accuracy !== 'number' || accuracy <= 0) {
      return { valid: false, error: 'Invalid accuracy value' };
    }

    // Check if accuracy meets threshold
    if (accuracy > this.maxAccuracyMismatch) {
      return { 
        valid: false, 
        error: `GPS accuracy (${accuracy}m) exceeds maximum allowed (${this.maxAccuracyMismatch}m)`,
        accuracy 
      };
    }

    return { valid: true, accuracy };
  }

  /**
   * Check if location is within geofence
   * @param {number} lat - User latitude
   * @param {number} lon - User longitude
   * @param {number} siteLat - Site latitude
   * @param {number} siteLon - Site longitude
   * @param {number} geofenceRadius - Geofence radius in meters
   * @returns {Object} Geofence check result
   */
  checkGeofence(lat, lon, siteLat, siteLon, geofenceRadius) {
    const distance = this.calculateDistance(lat, lon, siteLat, siteLon);
    const within = distance <= geofenceRadius;
    
    return {
      within,
      distance: Math.round(distance),
      geofenceRadius,
      message: within 
        ? `Within geofence (${Math.round(distance)}m of ${geofenceRadius}m radius)`
        : `Outside geofence (${Math.round(distance)}m from site, radius: ${geofenceRadius}m)`
    };
  }

  /**
   * Calculate distance between two points using Haversine formula
   * @param {number} lat1
   * @param {number} lon1
   * @param {number} lat2
   * @param {number} lon2
   * @returns {number} Distance in meters
   */
  calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000; // Earth radius in meters
    const dLat = this.toRadians(lat2 - lat1);
    const dLon = this.toRadians(lon2 - lon1);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(this.toRadians(lat1)) * Math.cos(this.toRadians(lat2)) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  /**
   * Convert degrees to radians
   * @param {number} degrees
   * @returns {number}
   */
  toRadians(degrees) {
    return degrees * (Math.PI / 180);
  }

  /**
   * Get site location and geofence
   * @param {string} siteId
   * @returns {Object|null}
   */
  getSiteLocation(siteId) {
    return this.sheets.getJobSiteById(siteId);
  }

  /**
   * Validate location against assigned site
   * @param {Object} params - Location parameters
   * @returns {Object} Validation result
   */
  validateLocation(params) {
    const { lat, lon, accuracy, siteId } = params;
    
    // Validate GPS quality
    const gpsValidation = this.validateGPS(lat, lon, accuracy);
    if (!gpsValidation.valid) {
      return { valid: false, ...gpsValidation };
    }

    // Get site location
    const site = this.getSiteLocation(siteId);
    if (!site) {
      return { valid: false, error: 'Assigned site not found' };
    }

    // Check geofence
    const geofenceRadius = parseFloat(site['Geofence Radius'] || site.GeofenceRadius || CONFIG.DEFAULT_GEOFENCE_RADIUS);
    const siteLat = parseFloat(site.Latitude);
    const siteLon = parseFloat(site.Longitude);
    
    const geofenceCheck = this.checkGeofence(lat, lon, siteLat, siteLon, geofenceRadius);
    
    return {
      valid: geofenceCheck.within,
      accuracy: gpsValidation.accuracy,
      distance: geofenceCheck.distance,
      geofenceRadius,
      message: geofenceCheck.message
    };
  }
}

module.exports = new LocationService();