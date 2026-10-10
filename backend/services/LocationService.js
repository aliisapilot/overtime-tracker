/**
 * Location Service
 * Handles GPS validation, geofence checking, and location utilities
 * Dual compatible with Google Apps Script and Node.js
 */

var _ConfigModule = (typeof CONFIG !== 'undefined') 
  ? { CONFIG: CONFIG } 
  : (typeof require !== 'undefined' ? require('../lib/Config') : { CONFIG: {} });
var _CONFIG = _ConfigModule.CONFIG;

var _SheetsService = (typeof SheetsService !== 'undefined')
  ? SheetsService
  : (typeof require !== 'undefined' ? require('./SheetsService') : null);

var LocationService = (function() {
  function LocationServiceClass() {
    this.accuracyThreshold = _CONFIG.GPS_ACCURACY_THRESHOLD || 20;
    this.maxAccuracyMismatch = _CONFIG.GPS_MAX_ACCURACY_MISMATCH || 30;
    this.retryAttempts = _CONFIG.GPS_RETRY_ATTEMPTS || 3;
  }

  /**
   * Validate GPS coordinates and reported accuracy
   * Target accuracy: 20m; Maximum allowed fallback: 30m
   * @param {number} lat - Latitude
   * @param {number} lon - Longitude
   * @param {number} accuracy - Reported accuracy in meters
   * @returns {Object} Validation result
   */
  LocationServiceClass.prototype.validateGPS = function(lat, lon, accuracy) {
    var numLat = parseFloat(lat);
    var numLon = parseFloat(lon);
    var numAcc = parseFloat(accuracy);

    if (isNaN(numLat) || isNaN(numLon)) {
      return { valid: false, error: 'Invalid GPS coordinates provided' };
    }

    if (numLat < -90 || numLat > 90 || numLon < -180 || numLon > 180) {
      return { valid: false, error: 'Coordinates out of geographical range' };
    }

    if (isNaN(numAcc) || numAcc <= 0) {
      return { valid: false, error: 'GPS accuracy measurement is missing or invalid' };
    }

    // Check against maximum allowed tolerance (30m)
    if (numAcc > this.maxAccuracyMismatch) {
      return { 
        valid: false, 
        error: 'GPS accuracy (' + Math.round(numAcc) + 'm) exceeds maximum acceptable limit (' + this.maxAccuracyMismatch + 'm). Please acquire a stronger satellite signal.',
        accuracy: numAcc,
        targetAccuracy: this.accuracyThreshold,
        maxAccuracy: this.maxAccuracyMismatch
      };
    }

    return { 
      valid: true, 
      accuracy: numAcc,
      isOptimal: numAcc <= this.accuracyThreshold
    };
  };

  /**
   * Calculate distance between two points using Haversine formula
   * @param {number} lat1
   * @param {number} lon1
   * @param {number} lat2
   * @param {number} lon2
   * @returns {number} Distance in meters
   */
  LocationServiceClass.prototype.calculateDistance = function(lat1, lon1, lat2, lon2) {
    var R = 6371000; // Earth radius in meters
    var dLat = this.toRadians(lat2 - lat1);
    var dLon = this.toRadians(lon2 - lon1);
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(this.toRadians(lat1)) * Math.cos(this.toRadians(lat2)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  /**
   * Convert degrees to radians
   */
  LocationServiceClass.prototype.toRadians = function(degrees) {
    return degrees * (Math.PI / 180);
  };

  /**
   * Check if location is within geofence radius of site
   * @param {number} lat - User latitude
   * @param {number} lon - User longitude
   * @param {number} siteLat - Site latitude
   * @param {number} siteLon - Site longitude
   * @param {number} geofenceRadius - Geofence radius in meters
   * @returns {Object} Geofence check result
   */
  LocationServiceClass.prototype.checkGeofence = function(lat, lon, siteLat, siteLon, geofenceRadius) {
    var distance = this.calculateDistance(lat, lon, siteLat, siteLon);
    var within = distance <= geofenceRadius;
    
    return {
      within: within,
      distance: Math.round(distance),
      geofenceRadius: geofenceRadius,
      message: within 
        ? 'Within geofence (' + Math.round(distance) + 'm of ' + geofenceRadius + 'm boundary)'
        : 'Outside assigned work site (' + Math.round(distance) + 'm away, allowed radius is ' + geofenceRadius + 'm)'
    };
  };

  LocationServiceClass.prototype.validateLocation = function(params) {
    var lat = parseFloat(params.lat != null ? params.lat : params.latitude);
    var lon = parseFloat(params.lon != null ? params.lon : (params.longitude != null ? params.longitude : params.lng));
    var accuracy = parseFloat(params.accuracy);
    var siteId = params.siteId;

    // 1. Validate GPS signal quality
    var gpsValidation = this.validateGPS(lat, lon, accuracy);
    if (!gpsValidation.valid) {
      return { 
        valid: false, 
        error: gpsValidation.error,
        accuracy: gpsValidation.accuracy,
        message: gpsValidation.error
      };
    }

    // 2. Fetch site
    var sheets = _SheetsService;
    var site = sheets ? sheets.getJobSiteById(siteId) : null;
    if (!site) {
      return { valid: false, error: 'Assigned job site (' + siteId + ') was not found' };
    }

    var siteLat = parseFloat(site.Latitude);
    var siteLon = parseFloat(site.Longitude);
    var geofenceRadius = parseFloat(site['Geofence Radius'] || site.GeofenceRadius || _CONFIG.DEFAULT_GEOFENCE_RADIUS || 100);

    // 3. Check geofence
    var geofenceCheck = this.checkGeofence(lat, lon, siteLat, siteLon, geofenceRadius);
    
    return {
      valid: geofenceCheck.within,
      accuracy: gpsValidation.accuracy,
      isOptimal: gpsValidation.isOptimal,
      distance: geofenceCheck.distance,
      geofenceRadius: geofenceRadius,
      message: geofenceCheck.message,
      siteName: site.Name
    };
  };

  return new LocationServiceClass();
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = LocationService;
}