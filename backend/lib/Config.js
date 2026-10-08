/**
 * Configuration and constants for Overtime Tracker
 * Compatible with both Google Apps Script global scope and Node.js
 */
var CONFIG = {
  SESSION_TIMEOUT: 24 * 60 * 60 * 1000, // 24 hours
  MAX_LOGIN_ATTEMPTS: 5,
  LOCKOUT_TIME_MS: 15 * 60 * 1000, // 15 minutes lockout after max attempts
  LOCK_TIMEOUT: 30 * 1000, // 30 seconds LockService timeout
  GPS_ACCURACY_THRESHOLD: 20, // 20m target accuracy
  GPS_RETRY_ATTEMPTS: 3,
  GPS_MAX_ACCURACY_MISMATCH: 30, // 30m maximum allowed fallback
  DEFAULT_GEOFENCE_RADIUS: 100, // 100m geofence default
  DEFAULT_REGULAR_HOURS: 8,
  DEFAULT_BREAK_DURATION: 60, // 60 minutes
  PBKDF2_ITERATIONS: 2000, // Iterations for PIN hashing
  ADMIN_ROLE: 'Admin',
  LABOURER_ROLE: 'Labourer'
};

var SHEETS = {
  EMPLOYEES: 'Employees',
  JOB_SITES: 'Job Sites',
  SHIFTS: 'Shifts',
  OVERTIME: 'Overtime',
  SETTINGS: 'Settings',
  AUDIT_LOGS: 'Audit Logs'
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CONFIG: CONFIG, SHEETS: SHEETS };
}