/**
 * OVERTIME TRACKER — COMPLETE GOOGLE APPS SCRIPT BACKEND
 * Bundled for single-file deployment at script.google.com
 * Owner: Ateeb
 * Generated: 2026-10-08T20:24:15.201Z
 */


// ==========================================
// FILE: lib/Config.js
// ==========================================

/**
 * Configuration and constants for Overtime Tracker
 * Dual compatible with Google Apps Script global scope and Node.js
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
  PBKDF2_ITERATIONS: 25000, // Strengthened PBKDF2 iterations for PIN security
  SALT_LENGTH: 32, // 256-bit salt entropy
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


// ==========================================
// FILE: lib/CryptoUtils.js
// ==========================================

/**
 * Cryptographic utilities for Overtime Tracker
 * Standard RFC 2898 / RFC 7914 PBKDF2 (HMAC-SHA256) implementation
 * Fully verified against standard test vectors
 * Compatible with both Google Apps Script runtime and Node.js
 */

var _ConfigModule = (typeof CONFIG !== 'undefined') ? { CONFIG: CONFIG } : 
  (typeof require !== 'undefined' ? require('./Config') : { CONFIG: { PBKDF2_ITERATIONS: 25000, SESSION_TIMEOUT: 86400000, SALT_LENGTH: 32 } });
var _CONFIG = _ConfigModule.CONFIG;

var CryptoUtils = (function() {
  var _nodeRuntimeSecret = null;

  /**
   * Helper: compute HMAC-SHA256
   */
  function hmacSha256(value, key) {
    if (typeof Utilities !== 'undefined' && Utilities.computeHmacSha256Signature) {
      var raw = Utilities.computeHmacSha256Signature(value, key, Utilities.Charset.UTF_8);
      return raw.map(function(b) {
        return (b < 0 ? b + 256 : b).toString(16).padStart(2, '0');
      }).join('');
    } else {
      var crypto = require('crypto');
      return crypto.createHmac('sha256', key).update(value).digest('hex');
    }
  }

  /**
   * Helper: compute SHA-256
   */
  function sha256(value) {
    if (typeof Utilities !== 'undefined' && Utilities.computeDigest) {
      var raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8);
      return raw.map(function(b) {
        return (b < 0 ? b + 256 : b).toString(16).padStart(2, '0');
      }).join('');
    } else {
      var crypto = require('crypto');
      return crypto.createHash('sha256').update(value).digest('hex');
    }
  }

  /**
   * Helper: generate cryptographically random hex salt
   */
  function generateSalt(length) {
    length = length || _CONFIG.SALT_LENGTH || 32;
    if (typeof Utilities !== 'undefined' && Utilities.getUuid) {
      var uuids = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
      return uuids.substring(0, length);
    } else {
      var crypto = require('crypto');
      return crypto.randomBytes(Math.ceil(length / 2)).toString('hex').substring(0, length);
    }
  }

  /**
   * Base64 encode string (URL-safe)
   */
  function toBase64(str) {
    if (typeof Utilities !== 'undefined' && Utilities.base64EncodeWebSafe) {
      return Utilities.base64EncodeWebSafe(str);
    } else if (typeof Buffer !== 'undefined') {
      return Buffer.from(str, 'utf8').toString('base64url');
    } else {
      return btoa(unescape(encodeURIComponent(str)));
    }
  }

  /**
   * Base64 decode string
   */
  function fromBase64(b64) {
    if (typeof Utilities !== 'undefined' && Utilities.base64DecodeWebSafe) {
      var bytes = Utilities.base64DecodeWebSafe(b64);
      return Utilities.newBlob(bytes).getDataAsString();
    } else if (typeof Buffer !== 'undefined') {
      return Buffer.from(b64, 'base64url').toString('utf8');
    } else {
      return decodeURIComponent(escape(atob(b64)));
    }
  }

  /**
   * Constant-time string comparison to prevent timing attacks
   */
  function safeCompare(a, b) {
    if (!a || !b || a.length !== b.length) {
      return false;
    }
    var result = 0;
    for (var i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return result === 0;
  }

  /**
   * Convert string to byte array compatible with Google Apps Script signed bytes
   */
  function stringToBytes(str) {
    if (typeof Utilities !== 'undefined' && Utilities.newBlob) {
      return Utilities.newBlob(str).getBytes();
    } else if (typeof Buffer !== 'undefined') {
      var buf = Buffer.from(str, 'utf8');
      return Array.from(buf).map(function(b) { return (b > 127 ? b - 256 : b); });
    } else {
      var bytes = [];
      for (var i = 0; i < str.length; i++) {
        var code = str.charCodeAt(i);
        bytes.push(code > 127 ? code - 256 : code);
      }
      return bytes;
    }
  }

  /**
   * Standard RFC 2898 / RFC 7914 PBKDF2 (HMAC-SHA256) implementation
   * Verified against standard test vectors
   * @param {string} password
   * @param {string} salt
   * @param {number} iterations
   * @param {number} [dkLen] - Derived key length in bytes (default 32)
   * @returns {string} Hex-encoded derived key
   */
  function pbkdf2Standard(password, salt, iterations, dkLen) {
    dkLen = dkLen || 32;

    // Fast path if in Node.js
    if (typeof crypto !== 'undefined' && crypto.pbkdf2Sync) {
      return crypto.pbkdf2Sync(password, salt, iterations, dkLen, 'sha256').toString('hex');
    }
    if (typeof require !== 'undefined') {
      try {
        var nodeCrypto = require('crypto');
        if (nodeCrypto && nodeCrypto.pbkdf2Sync) {
          return nodeCrypto.pbkdf2Sync(password, salt, iterations, dkLen, 'sha256').toString('hex');
        }
      } catch (e) {
        // Fall back to pure GAS implementation below
      }
    }

    // Google Apps Script pure implementation using Utilities.computeHmacSha256Signature
    var passBytes = stringToBytes(password);
    var saltBytes = stringToBytes(salt);

    // Block 1: salt || 0x00 0x00 0x00 0x01
    var initial = saltBytes.concat([0, 0, 0, 1]);
    var u = Utilities.computeHmacSha256Signature(initial, passBytes);
    var t = u.slice();

    for (var i = 1; i < iterations; i++) {
      u = Utilities.computeHmacSha256Signature(u, passBytes);
      for (var j = 0; j < 32; j++) {
        t[j] = (t[j] ^ u[j]);
      }
    }

    return t.slice(0, dkLen).map(function(b) {
      return (b < 0 ? b + 256 : b).toString(16).padStart(2, '0');
    }).join('');
  }

  /**
   * Hash a PIN with standard RFC 2898 PBKDF2 and a unique 256-bit salt
   * @param {string} pin - Plain text PIN
   * @param {string} [salt] - Optional salt
   * @param {number} [iterations] - Optional iterations
   * @returns {string} Stored hash in format pbkdf2:<iterations>:<salt>:<hash>
   */
  function hashPin(pin, salt, iterations) {
    if (typeof pin !== 'string') {
      pin = String(pin || '');
    }
    salt = salt || generateSalt(_CONFIG.SALT_LENGTH || 32);
    iterations = iterations || _CONFIG.PBKDF2_ITERATIONS || 25000;
    var derived = pbkdf2Standard(pin, salt, iterations, 32);
    return 'pbkdf2:' + iterations + ':' + salt + ':' + derived;
  }

  /**
   * Verify a PIN against a stored hash using constant-time comparison
   * @param {string} pin - Plain text PIN
   * @param {string} storedHash - Stored hash string
   * @returns {{ valid: boolean, shouldUpgrade: boolean }}
   */
  function verifyPin(pin, storedHash) {
    if (!pin || !storedHash) {
      return { valid: false, shouldUpgrade: false };
    }
    if (typeof pin !== 'string') {
      pin = String(pin);
    }

    // Modern RFC PBKDF2 format: pbkdf2:iterations:salt:hash
    if (storedHash.indexOf('pbkdf2:') === 0) {
      var parts = storedHash.split(':');
      if (parts.length === 4) {
        var iterations = parseInt(parts[1], 10);
        var salt = parts[2];
        var expectedHash = parts[3];
        var computedHash = pbkdf2Standard(pin, salt, iterations, 32);
        var isValid = safeCompare(computedHash, expectedHash);
        var shouldUpgrade = isValid && (iterations < (_CONFIG.PBKDF2_ITERATIONS || 25000));
        return { valid: isValid, shouldUpgrade: shouldUpgrade };
      }
    }

    // Legacy fallback: SHA-256 base64 digest with static salt (from prototype)
    try {
      var legacyInput = pin + 'salt_' + pin.length;
      var legacyHex = sha256(legacyInput);
      var legacyBase64 = (typeof Utilities !== 'undefined' && Utilities.base64Encode) 
        ? Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, legacyInput))
        : (typeof Buffer !== 'undefined' ? Buffer.from(legacyHex, 'hex').toString('base64') : '');

      if (safeCompare(storedHash, legacyBase64) || safeCompare(storedHash, legacyHex)) {
        return { valid: true, shouldUpgrade: true };
      }
    } catch (e) {
      // ignore
    }

    return { valid: false, shouldUpgrade: false };
  }

  /**
   * Get or initialize server auth secret for signing tokens
   */
  function getAuthSecret() {
    if (typeof PropertiesService !== 'undefined' && PropertiesService.getScriptProperties) {
      var props = PropertiesService.getScriptProperties();
      var secret = props.getProperty('AUTH_SECRET');
      if (!secret) {
        secret = generateSalt(32) + generateSalt(32);
        props.setProperty('AUTH_SECRET', secret);
      }
      return secret;
    }
    if (typeof process !== 'undefined' && process.env && process.env.AUTH_SECRET) {
      return process.env.AUTH_SECRET;
    }
    if (!_nodeRuntimeSecret) {
      _nodeRuntimeSecret = generateSalt(32) + generateSalt(32);
    }
    return _nodeRuntimeSecret;
  }

  /**
   * Create a signed session token
   * @param {Object} payload - User session data
   * @returns {string} Token in format <payloadB64>.<signature>
   */
  function createSessionToken(payload) {
    var secret = getAuthSecret();
    var now = Date.now();
    var exp = now + (_CONFIG.SESSION_TIMEOUT || (24 * 60 * 60 * 1000));
    
    var tokenData = {
      employeeId: payload.employeeId,
      name: payload.name,
      role: payload.role,
      siteId: payload.siteId || '',
      iat: now,
      exp: exp
    };

    var encodedPayload = toBase64(JSON.stringify(tokenData));
    var signature = hmacSha256(encodedPayload, secret);
    return encodedPayload + '.' + signature;
  }

  /**
   * Verify and decode a session token
   * @param {string} token
   * @returns {Object|null} Session payload if valid, null otherwise
   */
  function verifySessionToken(token) {
    if (!token || typeof token !== 'string') {
      return null;
    }
    var parts = token.split('.');
    if (parts.length !== 2) {
      return null;
    }

    var encodedPayload = parts[0];
    var providedSignature = parts[1];
    var secret = getAuthSecret();
    var expectedSignature = hmacSha256(encodedPayload, secret);

    if (!safeCompare(providedSignature, expectedSignature)) {
      return null;
    }

    try {
      var jsonStr = fromBase64(encodedPayload);
      var payload = JSON.parse(jsonStr);
      if (!payload.exp || payload.exp < Date.now()) {
        return null; // Expired
      }
      return payload;
    } catch (e) {
      return null;
    }
  }

  return {
    pbkdf2Standard: pbkdf2Standard,
    hashPin: hashPin,
    verifyPin: verifyPin,
    createSessionToken: createSessionToken,
    verifySessionToken: verifySessionToken,
    getAuthSecret: getAuthSecret,
    generateSalt: generateSalt,
    hmacSha256: hmacSha256,
    sha256: sha256
  };
})();



// ==========================================
// FILE: services/SheetsService.js
// ==========================================

/**
 * Google Sheets Service
 * Handles all interactions with Google Sheets database
 * Dual compatible with Google Apps Script and Node.js
 */

var _ConfigModule = (typeof CONFIG !== 'undefined' && typeof SHEETS !== 'undefined') 
  ? { CONFIG: CONFIG, SHEETS: SHEETS } 
  : (typeof require !== 'undefined' ? require('../lib/Config') : { CONFIG: {}, SHEETS: {} });

var _CONFIG = _ConfigModule.CONFIG;
var _SHEETS = _ConfigModule.SHEETS;

var _CryptoUtils = (typeof CryptoUtils !== 'undefined')
  ? CryptoUtils
  : (typeof require !== 'undefined' ? require('../lib/CryptoUtils') : null);

var SheetsService = (function() {
  function SheetsServiceClass() {
    this._mockData = null; // Used for local Node tests
  }

  /**
   * Set mock data for local automated testing
   */
  SheetsServiceClass.prototype.setMockData = function(data) {
    this._mockData = data;
  };

  /**
   * Get the active spreadsheet
   * @returns {GoogleAppsScript.Spreadsheet.Spreadsheet}
   */
  SheetsServiceClass.prototype.getSpreadsheet = function() {
    if (typeof SpreadsheetApp !== 'undefined') {
      return SpreadsheetApp.getActiveSpreadsheet();
    }
    return null;
  };

  /**
   * Get a sheet by name, create if it doesn't exist
   * @param {string} sheetName
   * @returns {GoogleAppsScript.Spreadsheet.Sheet}
   */
  SheetsServiceClass.prototype.getOrCreateSheet = function(sheetName) {
    var ss = this.getSpreadsheet();
    if (!ss) return null;
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
    }
    return sheet;
  };

  /**
   * Initialize all required sheets with headers and default records
   */
  SheetsServiceClass.prototype.initializeSheets = function() {
    var ss = this.getSpreadsheet();
    if (!ss) {
      if (typeof Logger !== 'undefined') {
        Logger.log('SpreadsheetApp not available - mock or local environment');
      }
      return { success: true, message: 'Local/mock environment initialization' };
    }

    // 1. Employees sheet
    var employeesSheet = this.getOrCreateSheet(_SHEETS.EMPLOYEES);
    this.ensureHeaders(employeesSheet, [
      'ID', 'Name', 'Phone', 'Role', 'Site ID', 'PIN Hash', 'Status', 'Created At', 'Last Accessed'
    ]);

    // 2. Job Sites sheet (Headers only - NO sample production sites)
    var jobSitesSheet = this.getOrCreateSheet(_SHEETS.JOB_SITES);
    this.ensureHeaders(jobSitesSheet, [
      'ID', 'Name', 'Address', 'Latitude', 'Longitude', 'Geofence Radius', 'Status', 'Created At'
    ]);

    // 3. Shifts sheet
    var shiftsSheet = this.getOrCreateSheet(_SHEETS.SHIFTS);
    this.ensureHeaders(shiftsSheet, [
      'ID', 'Employee ID', 'Site ID', 'Start Time', 'End Time',
      'Start Latitude', 'Start Longitude', 'Start Accuracy',
      'End Latitude', 'End Longitude', 'End Accuracy',
      'Break Minutes', 'Regular Hours', 'Overtime Hours', 'Status', 'Created At'
    ]);

    // 4. Overtime sheet
    var overtimeSheet = this.getOrCreateSheet(_SHEETS.OVERTIME);
    this.ensureHeaders(overtimeSheet, [
      'ID', 'Shift ID', 'Employee ID', 'Date', 'Overtime Hours',
      'Approval Status', 'Approved By', 'Approved At', 'Created At'
    ]);

    // 5. Settings sheet
    var settingsSheet = this.getOrCreateSheet(_SHEETS.SETTINGS);
    this.ensureHeaders(settingsSheet, [
      'Key', 'Value', 'Description', 'Updated At'
    ]);
    this.initializeDefaultSettings(settingsSheet);

    // 6. Audit Logs sheet
    var auditLogsSheet = this.getOrCreateSheet(_SHEETS.AUDIT_LOGS);
    this.ensureHeaders(auditLogsSheet, [
      'ID', 'Employee ID', 'Action', 'Outcome', 'Timestamp', 'Performed By', 'Details'
    ]);

    // Seed default admin employee if Employees sheet is empty (with secure random PIN)
    var adminInitResult = this.seedDefaultAdmin(employeesSheet);

    // Clean up empty default "Sheet1" if present and other sheets exist
    try {
      var defaultSheet = ss.getSheetByName('Sheet1');
      if (defaultSheet && ss.getSheets().length > 1 && defaultSheet.getLastRow() === 0) {
        ss.deleteSheet(defaultSheet);
      }
    } catch (e) {
      // Ignore sheet deletion error
    }

    if (typeof Logger !== 'undefined') {
      Logger.log('All sheets initialized successfully');
    }

    return { 
      success: true, 
      message: 'Spreadsheet initialized successfully',
      adminNote: adminInitResult ? adminInitResult.message : null
    };
  };

  /**
   * Ensure sheet has required headers without deleting data
   */
  SheetsServiceClass.prototype.ensureHeaders = function(sheet, headers) {
    if (!sheet) return;
    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();

    if (lastRow === 0 || lastCol === 0) {
      var range = sheet.getRange(1, 1, 1, headers.length);
      range.setValues([headers]);
      range.setFontWeight('bold');
      range.setBackground('#1e3a8a'); // Professional dark navy
      range.setFontColor('#ffffff');
      sheet.setFrozenRows(1);
      return;
    }

    var range = sheet.getRange(1, 1, 1, Math.max(lastCol, headers.length));
    var existingHeaders = range.getValues()[0];
    var isBlank = existingHeaders.every(function(h) { return h === ''; });

    if (isBlank) {
      var headerRange = sheet.getRange(1, 1, 1, headers.length);
      headerRange.setValues([headers]);
      headerRange.setFontWeight('bold');
      headerRange.setBackground('#1e3a8a');
      headerRange.setFontColor('#ffffff');
      sheet.setFrozenRows(1);
    }
  };

  /**
   * Initialize default settings if empty
   */
  SheetsServiceClass.prototype.initializeDefaultSettings = function(sheet) {
    if (!sheet) return;
    var defaults = [
      ['companyName', 'UAE Labour Management', 'Company name for reports', new Date().toISOString()],
      ['timezone', 'Asia/Dubai', 'IANA timezone identifier', new Date().toISOString()],
      ['regularHours', '8', 'Regular working hours per day', new Date().toISOString()],
      ['breakDuration', '60', 'Break duration in minutes', new Date().toISOString()],
      ['gpsAccuracyThreshold', '20', 'Target GPS accuracy in meters', new Date().toISOString()],
      ['gpsMaxAccuracyMismatch', '30', 'Maximum acceptable GPS accuracy in meters', new Date().toISOString()],
      ['defaultGeofenceRadius', '100', 'Default geofence radius in meters', new Date().toISOString()],
      ['gpsRetryAttempts', '3', 'Number of GPS retry attempts', new Date().toISOString()],
    ];

    if (sheet.getLastRow() <= 1) {
      sheet.getRange(2, 1, defaults.length, 4).setValues(defaults);
    }
  };

  /**
   * Seed Ateeb as default Admin using ADMIN_PIN configured in Script Properties
   * Completely avoids logging PINs or setup tokens to Execution Logs
   */
  SheetsServiceClass.prototype.seedDefaultAdmin = function(sheet) {
    if (!sheet && !this._mockData) {
      sheet = this.getOrCreateSheet(_SHEETS.EMPLOYEES);
    }
    
    // Check if EMP000 already exists
    var existingAdmin = this.findById(_SHEETS.EMPLOYEES, 'EMP000');

    var configuredPin = null;
    if (typeof PropertiesService !== 'undefined' && PropertiesService.getScriptProperties) {
      var props = PropertiesService.getScriptProperties();
      configuredPin = props.getProperty('ADMIN_PIN');
    } else if (this._mockAdminPin) {
      configuredPin = this._mockAdminPin;
    }

    if (!configuredPin) {
      if (existingAdmin && existingAdmin.Status === 'Active') {
        return { created: false, message: 'Admin account EMP000 is already active.' };
      }

      if (typeof Logger !== 'undefined') {
        Logger.log('[SECURITY NOTICE] To activate Administrator account (EMP000), set Script Property "ADMIN_PIN" in Project Settings and run activateAdmin() (or init()).');
      }
      if (!existingAdmin) {
        var placeholder = {
          ID: 'EMP000',
          Name: 'Ateeb',
          Phone: '+971500000000',
          Role: _CONFIG.ADMIN_ROLE || 'Admin',
          'Site ID': '',
          'PIN Hash': 'PENDING_PIN_CONFIGURATION',
          Status: 'PendingSetup',
          'Created At': new Date().toISOString(),
          'Last Accessed': ''
        };
        this.appendRow(_SHEETS.EMPLOYEES, placeholder);
      }
      return { created: false, message: 'Admin account pending setup. Add Script Property ADMIN_PIN and run activateAdmin().' };
    }

    // PIN is present in Script Properties: hash with standard PBKDF2 (25k iter, 32-char salt)
    var pinHash = _CryptoUtils.hashPin(configuredPin);

    if (existingAdmin) {
      this.updateRow(_SHEETS.EMPLOYEES, 'EMP000', {
        'PIN Hash': pinHash,
        Status: 'Active'
      });
    } else {
      var adminData = {
        ID: 'EMP000',
        Name: 'Ateeb',
        Phone: '+971500000000',
        Role: _CONFIG.ADMIN_ROLE || 'Admin',
        'Site ID': '',
        'PIN Hash': pinHash,
        Status: 'Active',
        'Created At': new Date().toISOString(),
        'Last Accessed': ''
      };
      this.appendRow(_SHEETS.EMPLOYEES, adminData);
    }

    // Immediately and securely delete plain text ADMIN_PIN property and any legacy tokens
    if (typeof PropertiesService !== 'undefined' && PropertiesService.getScriptProperties) {
      PropertiesService.getScriptProperties().deleteProperty('ADMIN_PIN');
      PropertiesService.getScriptProperties().deleteProperty('ONE_TIME_SETUP_TOKEN');
    }
    this._mockAdminPin = null;

    if (typeof Logger !== 'undefined') {
      Logger.log('[SECURITY] Administrator account (EMP000) successfully activated. The plain text ADMIN_PIN property has been securely deleted.');
    }

    return { created: true, message: 'Administrator account EMP000 successfully activated.' };
  };

  /**
   * Set mock admin PIN for automated tests
   */
  SheetsServiceClass.prototype.setMockAdminPin = function(pin) {
    this._mockAdminPin = pin;
  };

  /**
   * Get all rows from a sheet as plain objects
   * @param {string} sheetName
   * @returns {Object[]}
   */
  SheetsServiceClass.prototype.getAllRows = function(sheetName) {
    if (this._mockData && this._mockData[sheetName]) {
      return this._mockData[sheetName];
    }

    var sheet = this.getOrCreateSheet(sheetName);
    if (!sheet) return [];
    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) return [];

    var headers = data[0];
    return data.slice(1).map(function(row) {
      var obj = {};
      headers.forEach(function(header, i) {
        if (header) {
          obj[header] = row[i];
        }
      });
      return obj;
    });
  };

  /**
   * Find a row by ID
   * @param {string} sheetName
   * @param {string} id
   * @returns {Object|null}
   */
  SheetsServiceClass.prototype.findById = function(sheetName, id) {
    var rows = this.getAllRows(sheetName);
    return rows.find(function(row) { return String(row.ID) === String(id); }) || null;
  };

  /**
   * Append a new row
   * @param {string} sheetName
   * @param {Object} data
   * @returns {Object}
   */
  SheetsServiceClass.prototype.appendRow = function(sheetName, data) {
    if (this._mockData) {
      if (!this._mockData[sheetName]) this._mockData[sheetName] = [];
      this._mockData[sheetName].push(Object.assign({}, data));
      return data;
    }

    var sheet = this.getOrCreateSheet(sheetName);
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var rowData = headers.map(function(h) { return data[h] !== undefined ? data[h] : ''; });
    var newRow = sheet.getLastRow() + 1;
    sheet.getRange(newRow, 1, 1, rowData.length).setValues([rowData]);
    return this.findById(sheetName, data.ID);
  };

  /**
   * Update a row by ID
   * @param {string} sheetName
   * @param {string} id
   * @param {Object} data
   * @returns {boolean}
   */
  SheetsServiceClass.prototype.updateRow = function(sheetName, id, data) {
    if (this._mockData && this._mockData[sheetName]) {
      var index = this._mockData[sheetName].findIndex(function(r) { return String(r.ID) === String(id); });
      if (index !== -1) {
        Object.assign(this._mockData[sheetName][index], data);
        return true;
      }
      return false;
    }

    var sheet = this.getOrCreateSheet(sheetName);
    if (!sheet) return false;
    var dataRange = sheet.getDataRange();
    var values = dataRange.getValues();
    if (values.length <= 1) return false;
    var headers = values[0];

    for (var i = 1; i < values.length; i++) {
      if (String(values[i][0]) === String(id)) {
        var rowData = headers.map(function(h) {
          return data[h] !== undefined ? data[h] : values[i][headers.indexOf(h)];
        });
        sheet.getRange(i + 1, 1, 1, rowData.length).setValues([rowData]);
        return true;
      }
    }
    return false;
  };

  /**
   * Get employee by ID
   */
  SheetsServiceClass.prototype.getEmployeeById = function(employeeId) {
    return this.findById(_SHEETS.EMPLOYEES, employeeId);
  };

  /**
   * Get job site by ID
   */
  SheetsServiceClass.prototype.getJobSiteById = function(siteId) {
    return this.findById(_SHEETS.JOB_SITES, siteId);
  };

  /**
   * Get all employees
   */
  SheetsServiceClass.prototype.getAllEmployees = function() {
    return this.getAllRows(_SHEETS.EMPLOYEES);
  };

  /**
   * Get all job sites
   */
  SheetsServiceClass.prototype.getAllJobSites = function() {
    return this.getAllRows(_SHEETS.JOB_SITES);
  };

  /**
   * Get all shifts
   */
  SheetsServiceClass.prototype.getAllShifts = function() {
    return this.getAllRows(_SHEETS.SHIFTS);
  };

  /**
   * Get all overtime records
   */
  SheetsServiceClass.prototype.getAllOvertime = function() {
    return this.getAllRows(_SHEETS.OVERTIME);
  };

  /**
   * Get setting value
   */
  SheetsServiceClass.prototype.getSetting = function(key) {
    var settings = this.getAllRows(_SHEETS.SETTINGS);
    var setting = settings.find(function(s) { return s.Key === key; });
    return setting ? setting.Value : null;
  };

  /**
   * Set setting value
   */
  SheetsServiceClass.prototype.setSetting = function(key, value) {
    if (this._mockData && this._mockData[_SHEETS.SETTINGS]) {
      var item = this._mockData[_SHEETS.SETTINGS].find(function(s) { return s.Key === key; });
      if (item) {
        item.Value = value;
        item['Updated At'] = new Date().toISOString();
      } else {
        this._mockData[_SHEETS.SETTINGS].push({ Key: key, Value: value, Description: '', 'Updated At': new Date().toISOString() });
      }
      return;
    }

    var sheet = this.getOrCreateSheet(_SHEETS.SETTINGS);
    if (!sheet) return;
    var dataRange = sheet.getDataRange();
    var values = dataRange.getValues();

    for (var i = 1; i < values.length; i++) {
      if (values[i][0] === key) {
        sheet.getRange(i + 1, 2).setValue(value);
        sheet.getRange(i + 1, 4).setValue(new Date().toISOString());
        return;
      }
    }

    var newRow = sheet.getLastRow() + 1;
    sheet.getRange(newRow, 1, 1, 4).setValues([[key, value, '', new Date().toISOString()]]);
  };

  /**
   * Generate sequential/unique ID
   */
  SheetsServiceClass.prototype.generateId = function(prefix) {
    var timestamp = Date.now().toString(36);
    var random = Math.random().toString(36).substring(2, 6);
    return (prefix + timestamp + random).toUpperCase();
  };

  SheetsServiceClass.prototype.generateEmployeeId = function() {
    return this.generateId('EMP');
  };

  SheetsServiceClass.prototype.generateSiteId = function() {
    return this.generateId('SITE');
  };

  SheetsServiceClass.prototype.generateShiftId = function() {
    return this.generateId('SHIFT');
  };

  SheetsServiceClass.prototype.generateOvertimeId = function() {
    return this.generateId('OT');
  };

  SheetsServiceClass.prototype.generateAuditId = function() {
    return this.generateId('AL');
  };

  return new SheetsServiceClass();
})();


// ==========================================
// FILE: services/LocationService.js
// ==========================================

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

  /**
   * Validate user location against assigned job site
   * @param {Object} params - { lat, lon, accuracy, siteId }
   * @returns {Object}
   */
  LocationServiceClass.prototype.validateLocation = function(params) {
    var lat = parseFloat(params.lat);
    var lon = parseFloat(params.lon);
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


// ==========================================
// FILE: services/ShiftService.js
// ==========================================

/**
 * Shift Service
 * Handles starting/ending shifts with GPS validation, concurrency lock, and overtime calculation
 * Dual compatible with Google Apps Script and Node.js
 */

var _ConfigModule = (typeof CONFIG !== 'undefined' && typeof SHEETS !== 'undefined') 
  ? { CONFIG: CONFIG, SHEETS: SHEETS } 
  : (typeof require !== 'undefined' ? require('../lib/Config') : { CONFIG: {}, SHEETS: {} });
var _CONFIG = _ConfigModule.CONFIG;
var _SHEETS = _ConfigModule.SHEETS;

var _SheetsService = (typeof SheetsService !== 'undefined')
  ? SheetsService
  : (typeof require !== 'undefined' ? require('./SheetsService') : null);

var _LocationService = (typeof LocationService !== 'undefined')
  ? LocationService
  : (typeof require !== 'undefined' ? require('./LocationService') : null);

var ShiftService = (function() {
  function ShiftServiceClass() {
    this.regularHours = parseFloat(_CONFIG.DEFAULT_REGULAR_HOURS || 8);
    this.breakDuration = parseFloat(_CONFIG.DEFAULT_BREAK_DURATION || 60);
    this.lockTimeout = _CONFIG.LOCK_TIMEOUT || 30000;
  }

  /**
   * Acquire script lock for safe concurrency writes
   */
  ShiftServiceClass.prototype._acquireLock = function() {
    if (typeof LockService !== 'undefined' && LockService.getScriptLock) {
      var lock = LockService.getScriptLock();
      try {
        var acquired = lock.tryLock(this.lockTimeout);
        return { lock: lock, acquired: acquired };
      } catch (e) {
        return { lock: null, acquired: false };
      }
    }
    return { lock: null, acquired: true };
  };

  /**
   * Release lock safely
   */
  ShiftServiceClass.prototype._releaseLock = function(lockObj) {
    if (lockObj && lockObj.lock && lockObj.acquired) {
      try {
        lockObj.lock.releaseLock();
      } catch (e) {
        // ignore
      }
    }
  };

  /**
   * Log audit record
   */
  ShiftServiceClass.prototype.logAudit = function(employeeId, action, outcome, details, performedBy) {
    try {
      if (!_SheetsService) return;
      var auditId = _SheetsService.generateAuditId();
      var auditData = {
        ID: auditId,
        'Employee ID': employeeId,
        Action: action,
        Outcome: outcome,
        Timestamp: new Date().toISOString(),
        'Performed By': performedBy || employeeId || 'system',
        Details: details
      };
      _SheetsService.appendRow(_SHEETS.AUDIT_LOGS, auditData);
    } catch (e) {
      if (typeof Logger !== 'undefined') Logger.log('Audit error: ' + e);
    }
  };

  /**
   * Start a new shift
   * @param {Object} params - { employeeId, lat, lon, accuracy }
   * @returns {Object}
   */
  ShiftServiceClass.prototype.startShift = function(params) {
    var lockResult = this._acquireLock();
    if (!lockResult.acquired) {
      return { success: false, message: 'Server is currently processing another request. Please retry in a few seconds.' };
    }

    try {
      var employeeId = (params.employeeId || '').trim().toUpperCase();
      var lat = parseFloat(params.lat);
      var lon = parseFloat(params.lon);
      var accuracy = parseFloat(params.accuracy);

      if (!employeeId) {
        return { success: false, message: 'Employee ID is required' };
      }

      var employee = _SheetsService.getEmployeeById(employeeId);
      if (!employee) {
        return { success: false, message: 'Employee not found' };
      }

      if (employee.Status !== 'Active') {
        return { success: false, message: 'Employee account is not active' };
      }

      var siteId = employee['Site ID'] || employee.SiteID || params.siteId || 'FIELD';

      // Check if employee already has an active shift (duplicate prevention)
      var activeShift = this.getActiveShift(employeeId);
      if (activeShift) {
        return { 
          success: false, 
          message: 'You already have an active shift started at ' + activeShift['Start Time'] + '. Please end that shift before starting a new one.',
          activeShift: activeShift
        };
      }

      // Generate server timestamp
      var serverStartTime = new Date().toISOString();
      var shiftId = _SheetsService.generateShiftId();

      var shiftData = {
        ID: shiftId,
        'Employee ID': employeeId,
        'Site ID': siteId,
        'Start Time': serverStartTime,
        'End Time': '',
        'Start Latitude': !isNaN(lat) ? lat : '',
        'Start Longitude': !isNaN(lon) ? lon : '',
        'Start Accuracy': !isNaN(accuracy) ? accuracy : '',
        'End Latitude': '',
        'End Longitude': '',
        'End Accuracy': '',
        'Break Minutes': this.breakDuration,
        'Regular Hours': 0,
        'Overtime Hours': 0,
        Status: 'Active',
        'Created At': serverStartTime
      };

      _SheetsService.appendRow(_SHEETS.SHIFTS, shiftData);
      this.logAudit(employeeId, 'start_shift', 'success', 'Started shift ' + shiftId + ' (GPS: ' + lat + ', ' + lon + ')');

      return {
        success: true,
        shiftId: shiftId,
        startTime: serverStartTime,
        siteId: siteId,
        lat: lat,
        lon: lon,
        accuracy: accuracy,
        message: 'Shift started successfully'
      };
    } catch (err) {
      if (typeof Logger !== 'undefined') Logger.log('Start shift error: ' + err);
      return { success: false, message: 'Failed to start shift: ' + (err.message || err) };
    } finally {
      this._releaseLock(lockResult);
    }
  };

  /**
   * End an active shift
   * @param {Object} params - { employeeId, lat, lon, accuracy }
   * @returns {Object}
   */
  ShiftServiceClass.prototype.endShift = function(params) {
    var lockResult = this._acquireLock();
    if (!lockResult.acquired) {
      return { success: false, message: 'Server is currently processing another request. Please retry in a few seconds.' };
    }

    try {
      var employeeId = (params.employeeId || '').trim().toUpperCase();
      var lat = parseFloat(params.lat);
      var lon = parseFloat(params.lon);
      var accuracy = parseFloat(params.accuracy);

      if (!employeeId) {
        return { success: false, message: 'Employee ID is required' };
      }

      var activeShift = this.getActiveShift(employeeId);
      if (!activeShift) {
        return { success: false, message: 'No active shift found for this employee to end.' };
      }

      // Server-side clock out timestamp
      var serverEndTime = new Date().toISOString();

      // Calculate worked, regular, and overtime hours
      var breakMin = parseFloat(activeShift['Break Minutes'] || this.breakDuration);
      var hoursCalc = this.calculateHours(activeShift['Start Time'], serverEndTime, breakMin);

      var updateData = {
        'End Time': serverEndTime,
        'End Latitude': !isNaN(lat) ? lat : '',
        'End Longitude': !isNaN(lon) ? lon : '',
        'End Accuracy': !isNaN(accuracy) ? accuracy : '',
        'Regular Hours': hoursCalc.regularHours,
        'Overtime Hours': hoursCalc.overtimeHours,
        Status: 'Completed'
      };

      _SheetsService.updateRow(_SHEETS.SHIFTS, activeShift.ID, updateData);
      this.logAudit(employeeId, 'end_shift', 'success', 'Ended shift ' + activeShift.ID + ' (GPS: ' + lat + ', ' + lon + ')');

      // Create pending overtime record if overtime was performed
      var overtimeId = null;
      if (hoursCalc.overtimeHours > 0) {
        overtimeId = this.createOvertimeRecord(activeShift.ID, employeeId, serverEndTime, hoursCalc.overtimeHours);
      }

      var auditDetails = 'Ended shift ' + activeShift.ID + '. Total: ' + hoursCalc.totalHours + 'h (Regular: ' + hoursCalc.regularHours + 'h, OT: ' + hoursCalc.overtimeHours + 'h)';
      this.logAudit(employeeId, 'end_shift', 'success', auditDetails);

      return {
        success: true,
        shiftId: activeShift.ID,
        startTime: activeShift['Start Time'],
        endTime: serverEndTime,
        totalHours: hoursCalc.totalHours,
        regularHours: hoursCalc.regularHours,
        overtimeHours: hoursCalc.overtimeHours,
        overtimeId: overtimeId,
        message: 'Shift ended successfully'
      };
    } catch (err) {
      if (typeof Logger !== 'undefined') Logger.log('End shift error: ' + err);
      return { success: false, message: 'Failed to end shift: ' + (err.message || err) };
    } finally {
      this._releaseLock(lockResult);
    }
  };

  /**
   * Get active shift for employee
   */
  ShiftServiceClass.prototype.getActiveShift = function(employeeId) {
    var shifts = _SheetsService.getAllShifts();
    for (var i = 0; i < shifts.length; i++) {
      if (shifts[i]['Employee ID'] === employeeId && shifts[i].Status === 'Active') {
        return shifts[i];
      }
    }
    return null;
  };

  /**
   * Calculate regular and overtime hours with break and overnight shift handling
   * @param {string} startTime - ISO string
   * @param {string} endTime - ISO string
   * @param {number} breakMinutes
   * @returns {{ totalHours: number, regularHours: number, overtimeHours: number }}
   */
  ShiftServiceClass.prototype.calculateHours = function(startTime, endTime, breakMinutes) {
    var start = new Date(startTime).getTime();
    var end = new Date(endTime).getTime();

    var diffMs = end - start;
    if (diffMs < 0) {
      // Overnight fallback if only time was compared
      diffMs += 24 * 60 * 60 * 1000;
    }

    var totalElapsedHours = diffMs / (1000 * 60 * 60);
    var breakHours = (breakMinutes || 0) / 60;
    var netWorkedHours = Math.max(0, totalElapsedHours - breakHours);

    var regular = Math.min(netWorkedHours, this.regularHours);
    var overtime = Math.max(0, netWorkedHours - this.regularHours);

    return {
      totalHours: Math.round(netWorkedHours * 100) / 100,
      regularHours: Math.round(regular * 100) / 100,
      overtimeHours: Math.round(overtime * 100) / 100
    };
  };

  /**
   * Create pending overtime record
   */
  ShiftServiceClass.prototype.createOvertimeRecord = function(shiftId, employeeId, dateIso, overtimeHours) {
    var otId = _SheetsService.generateOvertimeId();
    var dateOnly = dateIso.split('T')[0];
    var otData = {
      ID: otId,
      'Shift ID': shiftId,
      'Employee ID': employeeId,
      Date: dateOnly,
      'Overtime Hours': overtimeHours,
      'Approval Status': 'Pending',
      'Approved By': '',
      'Approved At': '',
      'Created At': new Date().toISOString()
    };
    _SheetsService.appendRow(_SHEETS.OVERTIME, otData);
    return otId;
  };

  /**
   * Get shifts for employee
   */
  ShiftServiceClass.prototype.getEmployeeShifts = function(employeeId) {
    var all = _SheetsService.getAllShifts();
    return all.filter(function(s) { return s['Employee ID'] === employeeId; });
  };

  return new ShiftServiceClass();
})();


// ==========================================
// FILE: services/OvertimeService.js
// ==========================================

/**
 * Overtime Service
 * Handles overtime approval and management workflow
 * Dual compatible with Google Apps Script and Node.js
 */

var _ConfigModule = (typeof CONFIG !== 'undefined' && typeof SHEETS !== 'undefined') 
  ? { CONFIG: CONFIG, SHEETS: SHEETS } 
  : (typeof require !== 'undefined' ? require('../lib/Config') : { CONFIG: {}, SHEETS: {} });
var _CONFIG = _ConfigModule.CONFIG;
var _SHEETS = _ConfigModule.SHEETS;

var _SheetsService = (typeof SheetsService !== 'undefined')
  ? SheetsService
  : (typeof require !== 'undefined' ? require('./SheetsService') : null);

var OvertimeService = (function() {
  function OvertimeServiceClass() {}

  /**
   * Log audit record
   */
  OvertimeServiceClass.prototype.logAudit = function(employeeId, action, outcome, details, performedBy) {
    try {
      if (!_SheetsService) return;
      var auditId = _SheetsService.generateAuditId();
      var auditData = {
        ID: auditId,
        'Employee ID': employeeId,
        Action: action,
        Outcome: outcome,
        Timestamp: new Date().toISOString(),
        'Performed By': performedBy || 'Admin',
        Details: details
      };
      _SheetsService.appendRow(_SHEETS.AUDIT_LOGS, auditData);
    } catch (e) {
      if (typeof Logger !== 'undefined') Logger.log('Audit error: ' + e);
    }
  };

  /**
   * Approve or reject overtime record (Admin operation)
   * @param {Object} params - { overtimeId, status, approvedBy, note }
   * @param {Object} session - Validated admin session
   * @returns {Object}
   */
  OvertimeServiceClass.prototype.approveOvertime = function(params, session) {
    try {
      var overtimeId = params.overtimeId;
      var status = params.status;
      var approvedBy = (session && session.name) ? session.name : (params.approvedBy || 'Ateeb');

      if (!overtimeId || !status) {
        return { success: false, message: 'Overtime ID and approval status are required' };
      }

      if (status !== 'Approved' && status !== 'Rejected') {
        return { success: false, message: 'Status must be either "Approved" or "Rejected"' };
      }

      var record = _SheetsService.findById(_SHEETS.OVERTIME, overtimeId);
      if (!record) {
        return { success: false, message: 'Overtime record not found' };
      }

      if (record['Approval Status'] !== 'Pending') {
        return { 
          success: false, 
          message: 'Overtime record has already been processed as ' + record['Approval Status'] + ' on ' + record['Approved At'] 
        };
      }

      var serverTimestamp = new Date().toISOString();
      var updateData = {
        'Approval Status': status,
        'Approved By': approvedBy,
        'Approved At': serverTimestamp
      };

      _SheetsService.updateRow(_SHEETS.OVERTIME, overtimeId, updateData);

      var empId = record['Employee ID'];
      var hours = record['Overtime Hours'];
      this.logAudit(empId, 'Overtime ' + status, 'success', 
        'Overtime record ' + overtimeId + ' (' + hours + 'h) ' + status.toLowerCase() + ' by ' + approvedBy, approvedBy);

      return {
        success: true,
        overtimeId: overtimeId,
        status: status,
        approvedBy: approvedBy,
        approvedAt: serverTimestamp,
        message: 'Overtime record successfully ' + status.toLowerCase()
      };
    } catch (err) {
      if (typeof Logger !== 'undefined') Logger.log('Approve overtime error: ' + err);
      return { success: false, message: 'Failed to process overtime: ' + (err.message || err) };
    }
  };

  /**
   * Get all pending overtime records
   */
  OvertimeServiceClass.prototype.getPendingOvertime = function() {
    var all = _SheetsService.getAllOvertime();
    return all.filter(function(o) { return o['Approval Status'] === 'Pending'; });
  };

  /**
   * Get all overtime records
   */
  OvertimeServiceClass.prototype.getAllOvertime = function() {
    return _SheetsService.getAllOvertime();
  };

  /**
   * Get overtime records for employee
   */
  OvertimeServiceClass.prototype.getEmployeeOvertime = function(employeeId) {
    var all = _SheetsService.getAllOvertime();
    return all.filter(function(o) { return o['Employee ID'] === employeeId; });
  };

  return new OvertimeServiceClass();
})();


// ==========================================
// FILE: services/AdminService.js
// ==========================================

/**
 * Admin Service
 * Handles administrative operations: employee management, job site CRUD, attendance review & reports
 * Dual compatible with Google Apps Script and Node.js
 */

var _ConfigModule = (typeof CONFIG !== 'undefined' && typeof SHEETS !== 'undefined') 
  ? { CONFIG: CONFIG, SHEETS: SHEETS } 
  : (typeof require !== 'undefined' ? require('../lib/Config') : { CONFIG: {}, SHEETS: {} });
var _CONFIG = _ConfigModule.CONFIG;
var _SHEETS = _ConfigModule.SHEETS;

var _CryptoUtils = (typeof CryptoUtils !== 'undefined')
  ? CryptoUtils
  : (typeof require !== 'undefined' ? require('../lib/CryptoUtils') : null);

var _SheetsService = (typeof SheetsService !== 'undefined')
  ? SheetsService
  : (typeof require !== 'undefined' ? require('./SheetsService') : null);

var AdminService = (function() {
  function AdminServiceClass() {}

  /**
   * Log audit record
   */
  AdminServiceClass.prototype.logAudit = function(employeeId, action, outcome, details, performedBy) {
    try {
      if (!_SheetsService) return;
      var auditId = _SheetsService.generateAuditId();
      var auditData = {
        ID: auditId,
        'Employee ID': employeeId,
        Action: action,
        Outcome: outcome,
        Timestamp: new Date().toISOString(),
        'Performed By': performedBy || 'Ateeb (Admin)',
        Details: details
      };
      _SheetsService.appendRow(_SHEETS.AUDIT_LOGS, auditData);
    } catch (e) {
      if (typeof Logger !== 'undefined') Logger.log('Audit error: ' + e);
    }
  };

  /**
   * Get all job sites
   */
  AdminServiceClass.prototype.getJobSites = function() {
    try {
      var sites = _SheetsService.getAllJobSites();
      return {
        success: true,
        jobSites: sites.map(function(s) {
          return {
            id: s.ID,
            name: s.Name,
            address: s.Address || '',
            lat: parseFloat(s.Latitude),
            lon: parseFloat(s.Longitude),
            geofenceRadius: parseFloat(s['Geofence Radius'] || s.GeofenceRadius || _CONFIG.DEFAULT_GEOFENCE_RADIUS || 100),
            status: s.Status,
            createdAt: s['Created At'] || ''
          };
        })
      };
    } catch (error) {
      return { success: false, message: 'Failed to retrieve job sites: ' + (error.message || error) };
    }
  };

  /**
   * Create a new job site
   */
  AdminServiceClass.prototype.createJobSite = function(params, session) {
    try {
      var name = (params.name || '').trim();
      var address = (params.address || '').trim();
      var lat = parseFloat(params.lat != null ? params.lat : params.latitude);
      var lon = parseFloat(params.lon != null ? params.lon : (params.longitude != null ? params.longitude : params.lng));
      var geofenceRadius = parseFloat(params.geofenceRadius || params['Geofence Radius'] || _CONFIG.DEFAULT_GEOFENCE_RADIUS || 100);

      if (!name) {
        return { success: false, message: 'Job site name is required' };
      }
      if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
        return { success: false, message: 'Valid latitude (-90 to 90) and longitude (-180 to 180) coordinates are required' };
      }
      if (isNaN(geofenceRadius) || geofenceRadius < 10 || geofenceRadius > 5000) {
        return { success: false, message: 'Geofence radius must be between 10m and 5000m' };
      }

      var siteId = _SheetsService.generateSiteId();
      var siteData = {
        ID: siteId,
        Name: name,
        Address: address,
        Latitude: lat,
        Longitude: lon,
        'Geofence Radius': Math.round(geofenceRadius),
        Status: 'Active',
        'Created At': new Date().toISOString()
      };

      _SheetsService.appendRow(_SHEETS.JOB_SITES, siteData);
      var adminName = session ? session.name : 'Admin';
      this.logAudit('SYSTEM', 'create_job_site', 'success', 'Created site ' + siteId + ': ' + name + ' (' + lat + ', ' + lon + ', ' + geofenceRadius + 'm)', adminName);

      return {
        success: true,
        siteId: siteId,
        jobSite: siteData,
        message: 'Job site created successfully'
      };
    } catch (error) {
      return { success: false, message: 'Failed to create job site: ' + (error.message || error) };
    }
  };

  /**
   * Update an existing job site
   */
  AdminServiceClass.prototype.updateJobSite = function(params, session) {
    try {
      var siteId = (params.siteId || params.id || params.ID || '').trim();
      var name = (params.name || params.Name || '').trim();
      var address = (params.address != null ? params.address : (params.Address || '')).trim();
      var lat = parseFloat(params.lat != null ? params.lat : params.latitude);
      var lon = parseFloat(params.lon != null ? params.lon : (params.longitude != null ? params.longitude : params.lng));
      var geofenceRadius = parseFloat(params.geofenceRadius || params['Geofence Radius'] || _CONFIG.DEFAULT_GEOFENCE_RADIUS || 100);
      var status = (params.status || params.Status || 'Active').trim();

      if (!siteId) {
        return { success: false, message: 'Job site ID is required' };
      }
      var existingSite = _SheetsService.getJobSiteById(siteId);
      if (!existingSite) {
        return { success: false, message: 'Job site not found: ' + siteId };
      }
      if (!name) {
        return { success: false, message: 'Job site name is required' };
      }
      if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
        return { success: false, message: 'Valid latitude (-90 to 90) and longitude (-180 to 180) coordinates are required' };
      }
      if (isNaN(geofenceRadius) || geofenceRadius < 10 || geofenceRadius > 5000) {
        return { success: false, message: 'Geofence radius must be between 10m and 5000m' };
      }

      var updateData = {
        Name: name,
        Address: address,
        Latitude: lat,
        Longitude: lon,
        'Geofence Radius': Math.round(geofenceRadius),
        Status: status
      };

      var updated = _SheetsService.updateRow(_SHEETS.JOB_SITES, siteId, updateData);
      if (!updated) {
        return { success: false, message: 'Failed to update job site in spreadsheet' };
      }

      var adminName = session ? session.name : 'Admin';
      this.logAudit('SYSTEM', 'update_job_site', 'success', 'Updated site ' + siteId + ': ' + name + ' (' + lat + ', ' + lon + ', ' + geofenceRadius + 'm)', adminName);

      return {
        success: true,
        siteId: siteId,
        jobSite: Object.assign({}, existingSite, updateData),
        message: 'Job site updated successfully'
      };
    } catch (error) {
      return { success: false, message: 'Failed to update job site: ' + (error.message || error) };
    }
  };

  /**
   * Get all employees
   */
  AdminServiceClass.prototype.getEmployees = function() {
    try {
      var employees = _SheetsService.getAllEmployees();
      return {
        success: true,
        employees: employees.map(function(e) {
          return {
            id: e.ID,
            name: e.Name,
            phone: e.Phone || '',
            role: e.Role || 'Labourer',
            siteId: e['Site ID'] || e.SiteID || '',
            status: e.Status || 'Active',
            createdAt: e['Created At'] || '',
            lastAccessed: e['Last Accessed'] || ''
          };
        })
      };
    } catch (error) {
      return { success: false, message: 'Failed to retrieve employees: ' + (error.message || error) };
    }
  };

  /**
   * Create a new employee with securely hashed PBKDF2 PIN
   */
  AdminServiceClass.prototype.createEmployee = function(params, session) {
    try {
      var name = (params.name || '').trim();
      var phone = (params.phone || '').trim();
      var role = (params.role || _CONFIG.LABOURER_ROLE || 'Labourer').trim();
      var siteId = (params.siteId || '').trim();
      var pin = (params.pin || '').trim();

      if (!name || !phone || !pin) {
        return { success: false, message: 'Name, phone, and PIN are required' };
      }

      if (pin.length < 4) {
        return { success: false, message: 'PIN must be at least 4 digits' };
      }

      if (siteId) {
        var site = _SheetsService.getJobSiteById(siteId);
        if (!site) {
          return { success: false, message: 'Selected job site (' + siteId + ') does not exist' };
        }
      }

      var employeeId = _SheetsService.generateEmployeeId();
      var pinHash = _CryptoUtils.hashPin(pin);

      var employeeData = {
        ID: employeeId,
        Name: name,
        Phone: phone,
        Role: role,
        'Site ID': siteId,
        'PIN Hash': pinHash,
        Status: 'Active',
        'Created At': new Date().toISOString(),
        'Last Accessed': ''
      };

      _SheetsService.appendRow(_SHEETS.EMPLOYEES, employeeData);
      var adminName = session ? session.name : 'Admin';
      this.logAudit(employeeId, 'create_employee', 'success', 'Created employee ' + employeeId + ' (' + name + ', role: ' + role + ')', adminName);

      return {
        success: true,
        employeeId: employeeId,
        employee: {
          id: employeeId,
          name: name,
          phone: phone,
          role: role,
          siteId: siteId,
          status: 'Active'
        },
        message: 'Employee created successfully'
      };
    } catch (error) {
      return { success: false, message: 'Failed to create employee: ' + (error.message || error) };
    }
  };

  /**
   * Deactivate or activate an employee
   */
  AdminServiceClass.prototype.deactivateEmployee = function(params, session) {
    try {
      var employeeId = (params.employeeId || '').trim();
      var status = params.status || 'Inactive';

      if (!employeeId) {
        return { success: false, message: 'Employee ID is required' };
      }

      var updated = _SheetsService.updateRow(_SHEETS.EMPLOYEES, employeeId, {
        Status: status
      });

      if (!updated) {
        return { success: false, message: 'Employee not found' };
      }

      var adminName = session ? session.name : 'Admin';
      this.logAudit(employeeId, 'update_employee_status', 'success', 'Set status of employee ' + employeeId + ' to ' + status, adminName);

      return {
        success: true,
        message: 'Employee status updated to ' + status
      };
    } catch (error) {
      return { success: false, message: 'Failed to update employee status: ' + (error.message || error) };
    }
  };

  /**
   * Get attendance records with site and employee metadata
   */
  AdminServiceClass.prototype.getAttendance = function(params) {
    try {
      var date = params.date;
      var employeeId = params.employeeId;
      var siteId = params.siteId;

      var shifts = _SheetsService.getAllShifts();
      var employees = _SheetsService.getAllEmployees();
      var sites = _SheetsService.getAllJobSites();

      var empMap = {};
      employees.forEach(function(e) { empMap[e.ID] = e.Name; });

      var siteMap = {};
      sites.forEach(function(s) { siteMap[s.ID] = s.Name; });

      var filtered = shifts;

      if (date) {
        var targetDate = new Date(date).toISOString().split('T')[0];
        filtered = filtered.filter(function(s) {
          if (!s['Start Time']) return false;
          var sDate = new Date(s['Start Time']).toISOString().split('T')[0];
          return sDate === targetDate;
        });
      }

      if (employeeId) {
        filtered = filtered.filter(function(s) { return s['Employee ID'] === employeeId; });
      }

      if (siteId) {
        filtered = filtered.filter(function(s) { return s['Site ID'] === siteId; });
      }

      // Sort newest first
      filtered.sort(function(a, b) {
        return new Date(b['Start Time'] || 0) - new Date(a['Start Time'] || 0);
      });

      var attendance = filtered.map(function(s) {
        return {
          shiftId: s.ID,
          employeeId: s['Employee ID'],
          employeeName: empMap[s['Employee ID']] || 'Unknown',
          siteId: s['Site ID'],
          siteName: siteMap[s['Site ID']] || 'Unknown',
          startTime: s['Start Time'],
          endTime: s['End Time'] || null,
          startLat: s['Start Latitude'] ? parseFloat(s['Start Latitude']) : null,
          startLon: s['Start Longitude'] ? parseFloat(s['Start Longitude']) : null,
          startAccuracy: s['Start Accuracy'] ? parseFloat(s['Start Accuracy']) : null,
          endLat: s['End Latitude'] ? parseFloat(s['End Latitude']) : null,
          endLon: s['End Longitude'] ? parseFloat(s['End Longitude']) : null,
          endAccuracy: s['End Accuracy'] ? parseFloat(s['End Accuracy']) : null,
          breakMinutes: parseFloat(s['Break Minutes'] || 0),
          regularHours: parseFloat(s['Regular Hours'] || 0),
          overtimeHours: parseFloat(s['Overtime Hours'] || 0),
          status: s.Status
        };
      });

      return {
        success: true,
        total: attendance.length,
        attendance: attendance
      };
    } catch (error) {
      return { success: false, message: 'Failed to retrieve attendance: ' + (error.message || error) };
    }
  };

  /**
   * Correct attendance record with audit logging
   */
  AdminServiceClass.prototype.correctAttendance = function(params, session) {
    try {
      var shiftId = params.shiftId;
      var regularHours = params.regularHours !== undefined ? parseFloat(params.regularHours) : undefined;
      var overtimeHours = params.overtimeHours !== undefined ? parseFloat(params.overtimeHours) : undefined;
      var reason = params.reason || 'Admin manual correction';

      if (!shiftId) {
        return { success: false, message: 'Shift ID is required' };
      }

      var existingShift = _SheetsService.findById(_SHEETS.SHIFTS, shiftId);
      if (!existingShift) {
        return { success: false, message: 'Shift not found' };
      }

      var updateData = {};
      if (regularHours !== undefined) updateData['Regular Hours'] = regularHours;
      if (overtimeHours !== undefined) updateData['Overtime Hours'] = overtimeHours;

      _SheetsService.updateRow(_SHEETS.SHIFTS, shiftId, updateData);

      var adminName = session ? session.name : 'Admin';
      var details = 'Corrected shift ' + shiftId + '. Previous: Reg ' + existingShift['Regular Hours'] + 'h, OT ' + existingShift['Overtime Hours'] + 
                    'h -> New: Reg ' + (regularHours !== undefined ? regularHours : existingShift['Regular Hours']) + 'h, OT ' + 
                    (overtimeHours !== undefined ? overtimeHours : existingShift['Overtime Hours']) + 'h. Reason: ' + reason;

      this.logAudit(existingShift['Employee ID'], 'correct_attendance', 'success', details, adminName);

      return {
        success: true,
        message: 'Shift record corrected successfully'
      };
    } catch (error) {
      return { success: false, message: 'Failed to correct attendance: ' + (error.message || error) };
    }
  };

  /**
   * Get audit logs
   */
  AdminServiceClass.prototype.getAuditLogs = function(params) {
    try {
      var limit = parseInt(params.limit || 100, 10);
      var employeeId = params.employeeId;

      var logs = _SheetsService.getAllRows(_SHEETS.AUDIT_LOGS);
      if (employeeId) {
        logs = logs.filter(function(l) { return l['Employee ID'] === employeeId; });
      }

      logs.sort(function(a, b) {
        return new Date(b.Timestamp || 0) - new Date(a.Timestamp || 0);
      });

      return {
        success: true,
        auditLogs: logs.slice(0, limit)
      };
    } catch (error) {
      return { success: false, message: 'Failed to retrieve audit logs: ' + (error.message || error) };
    }
  };

  /**
   * Generate daily attendance report
   */
  AdminServiceClass.prototype.generateDailyReport = function(params) {
    try {
      var targetDateStr = params.date ? new Date(params.date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];

      var shifts = _SheetsService.getAllShifts().filter(function(s) {
        if (!s['Start Time']) return false;
        return new Date(s['Start Time']).toISOString().split('T')[0] === targetDateStr;
      });

      var employees = _SheetsService.getAllEmployees();
      var sites = _SheetsService.getAllJobSites();

      var report = {
        date: targetDateStr,
        totalActiveEmployees: employees.filter(function(e) { return e.Status === 'Active'; }).length,
        totalShifts: shifts.length,
        completedShifts: shifts.filter(function(s) { return s.Status === 'Completed'; }).length,
        activeShifts: shifts.filter(function(s) { return s.Status === 'Active'; }).length,
        totalRegularHours: Math.round(shifts.reduce(function(sum, s) { return sum + parseFloat(s['Regular Hours'] || 0); }, 0) * 100) / 100,
        totalOvertimeHours: Math.round(shifts.reduce(function(sum, s) { return sum + parseFloat(s['Overtime Hours'] || 0); }, 0) * 100) / 100,
        bySite: {},
        byEmployee: {}
      };

      shifts.forEach(function(s) {
        var siteId = s['Site ID'] || 'UNKNOWN';
        var empId = s['Employee ID'];

        if (!report.bySite[siteId]) {
          var siteObj = sites.find(function(site) { return site.ID === siteId; });
          report.bySite[siteId] = {
            siteName: siteObj ? siteObj.Name : siteId,
            shifts: 0,
            regularHours: 0,
            overtimeHours: 0
          };
        }
        report.bySite[siteId].shifts++;
        report.bySite[siteId].regularHours += parseFloat(s['Regular Hours'] || 0);
        report.bySite[siteId].overtimeHours += parseFloat(s['Overtime Hours'] || 0);

        if (!report.byEmployee[empId]) {
          var empObj = employees.find(function(emp) { return emp.ID === empId; });
          report.byEmployee[empId] = {
            employeeName: empObj ? empObj.Name : empId,
            shifts: 0,
            regularHours: 0,
            overtimeHours: 0
          };
        }
        report.byEmployee[empId].shifts++;
        report.byEmployee[empId].regularHours += parseFloat(s['Regular Hours'] || 0);
        report.byEmployee[empId].overtimeHours += parseFloat(s['Overtime Hours'] || 0);
      });

      return {
        success: true,
        report: report
      };
    } catch (error) {
      return { success: false, message: 'Failed to generate daily report: ' + (error.message || error) };
    }
  };

  /**
   * Generate monthly report
   */
  AdminServiceClass.prototype.generateMonthlyReport = function(params) {
    try {
      var targetYear = params.year ? parseInt(params.year, 10) : new Date().getFullYear();
      var targetMonth = params.month !== undefined ? parseInt(params.month, 10) : new Date().getMonth() + 1;

      var shifts = _SheetsService.getAllShifts().filter(function(s) {
        if (!s['Start Time']) return false;
        var d = new Date(s['Start Time']);
        return d.getFullYear() === targetYear && (d.getMonth() + 1) === targetMonth;
      });

      var employees = _SheetsService.getAllEmployees();

      var report = {
        year: targetYear,
        month: targetMonth,
        totalShifts: shifts.length,
        totalRegularHours: Math.round(shifts.reduce(function(sum, s) { return sum + parseFloat(s['Regular Hours'] || 0); }, 0) * 100) / 100,
        totalOvertimeHours: Math.round(shifts.reduce(function(sum, s) { return sum + parseFloat(s['Overtime Hours'] || 0); }, 0) * 100) / 100,
        byEmployee: {}
      };

      shifts.forEach(function(s) {
        var empId = s['Employee ID'];
        if (!report.byEmployee[empId]) {
          var empObj = employees.find(function(emp) { return emp.ID === empId; });
          report.byEmployee[empId] = {
            employeeName: empObj ? empObj.Name : empId,
            shiftsCount: 0,
            regularHours: 0,
            overtimeHours: 0,
            daysWorkedSet: {}
          };
        }
        report.byEmployee[empId].shiftsCount++;
        report.byEmployee[empId].regularHours += parseFloat(s['Regular Hours'] || 0);
        report.byEmployee[empId].overtimeHours += parseFloat(s['Overtime Hours'] || 0);
        var dayNum = new Date(s['Start Time']).getDate();
        report.byEmployee[empId].daysWorkedSet[dayNum] = true;
      });

      // Flatten daysWorkedSet to count
      Object.keys(report.byEmployee).forEach(function(id) {
        var item = report.byEmployee[id];
        item.daysWorked = Object.keys(item.daysWorkedSet).length;
        delete item.daysWorkedSet;
        item.regularHours = Math.round(item.regularHours * 100) / 100;
        item.overtimeHours = Math.round(item.overtimeHours * 100) / 100;
      });

      return {
        success: true,
        report: report
      };
    } catch (error) {
      return { success: false, message: 'Failed to generate monthly report: ' + (error.message || error) };
    }
  };

  return new AdminServiceClass();
})();


// ==========================================
// FILE: services/AuthService.js
// ==========================================

/**
 * Authentication Service
 * Handles employee authentication, PBKDF2 PIN verification, session issuance, and authorization
 * Dual compatible with Google Apps Script and Node.js
 */

var _ConfigModule = (typeof CONFIG !== 'undefined' && typeof SHEETS !== 'undefined') 
  ? { CONFIG: CONFIG, SHEETS: SHEETS } 
  : (typeof require !== 'undefined' ? require('../lib/Config') : { CONFIG: {}, SHEETS: {} });
var _CONFIG = _ConfigModule.CONFIG;
var _SHEETS = _ConfigModule.SHEETS;

var _CryptoUtils = (typeof CryptoUtils !== 'undefined')
  ? CryptoUtils
  : (typeof require !== 'undefined' ? require('../lib/CryptoUtils') : null);

var _SheetsService = (typeof SheetsService !== 'undefined')
  ? SheetsService
  : (typeof require !== 'undefined' ? require('./SheetsService') : null);

var AuthService = (function() {
  function AuthServiceClass() {
    this.maxAttempts = _CONFIG.MAX_LOGIN_ATTEMPTS || 5;
    this.lockoutTimeMs = _CONFIG.LOCKOUT_TIME_MS || (15 * 60 * 1000);
  }

  /**
   * Helper: log authentication events to Audit Logs sheet
   */
  AuthServiceClass.prototype.logAuthEvent = function(employeeId, action, outcome, details, performedBy) {
    try {
      if (!_SheetsService) return;
      var auditId = _SheetsService.generateAuditId();
      var auditData = {
        ID: auditId,
        'Employee ID': employeeId || 'ANONYMOUS',
        Action: action,
        Outcome: outcome,
        Timestamp: new Date().toISOString(),
        'Performed By': performedBy || employeeId || 'system',
        Details: details
      };
      _SheetsService.appendRow(_SHEETS.AUDIT_LOGS, auditData);
    } catch (e) {
      if (typeof Logger !== 'undefined') Logger.log('Audit log error: ' + e);
    }
  };

  /**
   * Check if an account is temporarily locked due to consecutive failed attempts
   */
  AuthServiceClass.prototype.isLocked = function(employeeId) {
    if (typeof CacheService !== 'undefined' && CacheService.getScriptCache) {
      var cache = CacheService.getScriptCache();
      var attempts = parseInt(cache.get('fail_' + employeeId) || '0', 10);
      return attempts >= this.maxAttempts;
    }
    return false;
  };

  /**
   * Record a failed login attempt
   */
  AuthServiceClass.prototype.recordFailedAttempt = function(employeeId) {
    if (typeof CacheService !== 'undefined' && CacheService.getScriptCache) {
      var cache = CacheService.getScriptCache();
      var key = 'fail_' + employeeId;
      var current = parseInt(cache.get(key) || '0', 10) + 1;
      cache.put(key, String(current), Math.ceil(this.lockoutTimeMs / 1000));
      return current;
    }
    return 1;
  };

  /**
   * Clear failed attempts upon successful login
   */
  AuthServiceClass.prototype.clearFailedAttempts = function(employeeId) {
    if (typeof CacheService !== 'undefined' && CacheService.getScriptCache) {
      CacheService.getScriptCache().remove('fail_' + employeeId);
    }
  };

  /**
   * Authenticate employee by Employee ID and PIN
   * @param {Object} params - { employeeId, pin }
   * @returns {Object} Result with token, user data or error
   */
  AuthServiceClass.prototype.login = function(params) {
    try {
      var employeeId = (params.employeeId || '').trim().toUpperCase();
      var pin = (params.pin || '').trim();

      if (!employeeId || !pin) {
        return { success: false, message: 'Employee ID and PIN are required' };
      }

      if (this.isLocked(employeeId)) {
        this.logAuthEvent(employeeId, 'login', 'failed', 'Account locked due to too many attempts');
        return { success: false, message: 'Account is temporarily locked due to too many failed attempts. Please wait 15 minutes.' };
      }

      var employee = _SheetsService.getEmployeeById(employeeId);
      if (!employee) {
        this.recordFailedAttempt(employeeId);
        this.logAuthEvent(employeeId, 'login', 'failed', 'Employee ID not found');
        return { success: false, message: 'Invalid Employee ID or PIN' };
      }

      if (employee.Status !== 'Active') {
        this.logAuthEvent(employeeId, 'login', 'failed', 'Employee status is ' + employee.Status);
        return { success: false, message: 'Account is inactive. Please contact administrator.' };
      }

      var storedHash = employee['PIN Hash'] || employee.PINHash || '';
      var verifyResult = _CryptoUtils.verifyPin(pin, storedHash);

      if (!verifyResult.valid) {
        var attempts = this.recordFailedAttempt(employeeId);
        var remaining = Math.max(0, this.maxAttempts - attempts);
        this.logAuthEvent(employeeId, 'login', 'failed', 'Invalid PIN attempt (' + attempts + '/' + this.maxAttempts + ')');
        return { 
          success: false, 
          message: 'Invalid Employee ID or PIN' + (remaining > 0 ? ' (' + remaining + ' attempts remaining)' : '')
        };
      }

      // Successful PIN verification: clear failure counter
      this.clearFailedAttempts(employeeId);

      // Upgrade hash to PBKDF2 if it was verified via legacy algorithm
      if (verifyResult.shouldUpgrade) {
        try {
          var newPbkdf2Hash = _CryptoUtils.hashPin(pin);
          _SheetsService.updateRow(_SHEETS.EMPLOYEES, employeeId, {
            'PIN Hash': newPbkdf2Hash
          });
        } catch (upgradeErr) {
          // Non-fatal
        }
      }

      // Record last accessed timestamp
      _SheetsService.updateRow(_SHEETS.EMPLOYEES, employeeId, {
        'Last Accessed': new Date().toISOString()
      });

      // Issue signed session token
      var siteId = employee['Site ID'] || employee.SiteID || '';
      var role = employee.Role || _CONFIG.LABOURER_ROLE || 'Labourer';
      var token = _CryptoUtils.createSessionToken({
        employeeId: employee.ID,
        name: employee.Name,
        role: role,
        siteId: siteId
      });

      this.logAuthEvent(employeeId, 'login', 'success', 'Successful login (' + role + ')');

      var site = siteId ? _SheetsService.getJobSiteById(siteId) : null;

      return {
        success: true,
        token: token,
        employee: {
          id: employee.ID,
          name: employee.Name,
          role: role,
          phone: employee.Phone || '',
          siteId: siteId,
          siteName: site ? site.Name : '',
          siteLat: site ? parseFloat(site.Latitude) : null,
          siteLon: site ? parseFloat(site.Longitude) : null,
          geofenceRadius: site ? parseFloat(site['Geofence Radius'] || site.GeofenceRadius || _CONFIG.DEFAULT_GEOFENCE_RADIUS) : 100
        }
      };
    } catch (error) {
      if (typeof Logger !== 'undefined') Logger.log('Login error: ' + error);
      return { success: false, message: 'Authentication service error: ' + (error.message || error) };
    }
  };

  /**
   * Validate session token from incoming request
   * @param {string} token
   * @returns {{ valid: boolean, session: Object|null, error?: string }}
   */
  AuthServiceClass.prototype.validateSession = function(token) {
    if (!token) {
      return { valid: false, session: null, error: 'Session token is missing' };
    }
    var session = _CryptoUtils.verifySessionToken(token);
    if (!session) {
      return { valid: false, session: null, error: 'Invalid or expired session token. Please log in again.' };
    }
    return { valid: true, session: session };
  };

  /**
   * Get employee data for active session
   */
  AuthServiceClass.prototype.getEmployeeData = function(params) {
    try {
      var employeeId = params.employeeId;
      if (!employeeId) {
        return { success: false, message: 'Employee ID required' };
      }

      var employee = _SheetsService.getEmployeeById(employeeId);
      if (!employee) {
        return { success: false, message: 'Employee not found' };
      }

      var siteId = employee['Site ID'] || employee.SiteID;
      var site = siteId ? _SheetsService.getJobSiteById(siteId) : null;

      return {
        success: true,
        employee: {
          id: employee.ID,
          name: employee.Name,
          phone: employee.Phone,
          role: employee.Role,
          siteId: siteId,
          siteName: site ? site.Name : 'Unassigned',
          siteLat: site ? parseFloat(site.Latitude) : null,
          siteLon: site ? parseFloat(site.Longitude) : null,
          geofenceRadius: site ? parseFloat(site['Geofence Radius'] || site.GeofenceRadius || _CONFIG.DEFAULT_GEOFENCE_RADIUS) : 100,
          status: employee.Status
        }
      };
    } catch (error) {
      return { success: false, message: 'Failed to fetch employee details' };
    }
  };

  /**
   * Change employee PIN securely
   */
  AuthServiceClass.prototype.changePin = function(params, session) {
    var employeeId = params.employeeId;
    var currentPin = params.currentPin;
    var newPin = params.newPin;

    if (!employeeId || !currentPin || !newPin) {
      return { success: false, message: 'Employee ID, current PIN, and new PIN are required' };
    }

    if (newPin.length < 4) {
      return { success: false, message: 'New PIN must be at least 4 digits' };
    }

    // Must be either self or Admin
    if (session.role !== _CONFIG.ADMIN_ROLE && session.employeeId !== employeeId) {
      return { success: false, message: 'Unauthorized to change PIN for another employee' };
    }

    var employee = _SheetsService.getEmployeeById(employeeId);
    if (!employee) {
      return { success: false, message: 'Employee not found' };
    }

    // Verify current PIN (admins can reset without current PIN if adminOverride is true)
    if (!params.adminOverride) {
      var storedHash = employee['PIN Hash'] || employee.PINHash;
      var verifyResult = _CryptoUtils.verifyPin(currentPin, storedHash);
      if (!verifyResult.valid) {
        return { success: false, message: 'Current PIN is incorrect' };
      }
    }

    var newHash = _CryptoUtils.hashPin(newPin);
    _SheetsService.updateRow(_SHEETS.EMPLOYEES, employeeId, {
      'PIN Hash': newHash
    });

    this.logAuthEvent(employeeId, 'change_pin', 'success', 'PIN updated securely', session.employeeId);

    return { success: true, message: 'PIN updated successfully' };
  };

  /**
   * One-time secure administrator PIN setup
   */
  AuthServiceClass.prototype.setupAdmin = function(params) {
    try {
      var setupToken = (params.setupToken || '').trim();
      var newPin = (params.newPin || '').trim();

      if (!setupToken || !newPin) {
        return { success: false, message: 'Setup token and new PIN are required' };
      }

      if (newPin.length < 4) {
        return { success: false, message: 'Admin PIN must be at least 4 digits' };
      }

      // Check server setup token in Script Properties (or mock property for testing)
      var storedToken = null;
      if (typeof PropertiesService !== 'undefined' && PropertiesService.getScriptProperties) {
        storedToken = PropertiesService.getScriptProperties().getProperty('ONE_TIME_SETUP_TOKEN');
      } else if (this._mockSetupToken) {
        storedToken = this._mockSetupToken;
      }

      if (!storedToken || storedToken !== setupToken) {
        return { success: false, code: 403, message: 'Invalid or already used one-time setup token' };
      }

      var admin = _SheetsService.getEmployeeById('EMP000');
      if (!admin) {
        return { success: false, message: 'Admin account EMP000 not found' };
      }

      var newHash = _CryptoUtils.hashPin(newPin);
      _SheetsService.updateRow(_SHEETS.EMPLOYEES, 'EMP000', {
        'PIN Hash': newHash,
        Status: 'Active'
      });

      // Permanently destroy one-time setup token
      if (typeof PropertiesService !== 'undefined' && PropertiesService.getScriptProperties) {
        PropertiesService.getScriptProperties().deleteProperty('ONE_TIME_SETUP_TOKEN');
      }
      this._mockSetupToken = null;

      this.logAuthEvent('EMP000', 'admin_setup', 'success', 'Admin account activated via one-time setup token', 'Ateeb');

      return {
        success: true,
        message: 'Admin account successfully activated. You can now log in with Employee ID EMP000 and your private PIN.'
      };
    } catch (err) {
      return { success: false, message: 'Setup failed: ' + (err.message || err) };
    }
  };

  /**
   * Setter for mock setup token during automated tests
   */
  AuthServiceClass.prototype.setMockSetupToken = function(token) {
    this._mockSetupToken = token;
  };

  return new AuthServiceClass();
})();


// ==========================================
// FILE: Code.gs
// ==========================================

/**
 * Overtime Tracker — Google Apps Script Main Web App Entry Point
 * Handles doGet and doPost with authentication gatekeeping and role-based authorization
 * Dual compatible with Google Apps Script runtime and Node.js
 */

var _ConfigModule = (typeof CONFIG !== 'undefined' && typeof SHEETS !== 'undefined') 
  ? { CONFIG: CONFIG, SHEETS: SHEETS } 
  : (typeof require !== 'undefined' ? require('./lib/Config') : { CONFIG: {}, SHEETS: {} });
var _CONFIG = _ConfigModule.CONFIG;
var _SHEETS = _ConfigModule.SHEETS;

var _AuthService = (typeof AuthService !== 'undefined') ? AuthService : 
  (typeof require !== 'undefined' ? require('./services/AuthService') : null);

var _ShiftService = (typeof ShiftService !== 'undefined') ? ShiftService : 
  (typeof require !== 'undefined' ? require('./services/ShiftService') : null);

var _LocationService = (typeof LocationService !== 'undefined') ? LocationService : 
  (typeof require !== 'undefined' ? require('./services/LocationService') : null);

var _OvertimeService = (typeof OvertimeService !== 'undefined') ? OvertimeService : 
  (typeof require !== 'undefined' ? require('./services/OvertimeService') : null);

var _AdminService = (typeof AdminService !== 'undefined') ? AdminService : 
  (typeof require !== 'undefined' ? require('./services/AdminService') : null);

var _SheetsService = (typeof SheetsService !== 'undefined') ? SheetsService : 
  (typeof require !== 'undefined' ? require('./services/SheetsService') : null);

/**
 * Handle GET requests - health check & API metadata
 */
function doGet(e) {
  return jsonResponse({
    name: 'Overtime Tracker & Attendance API',
    version: '1.2.0',
    owner: 'Ateeb',
    status: 'active',
    timestamp: new Date().toISOString()
  });
}

/**
 * Handle POST requests - routes to appropriate services with auth verification
 */
function doPost(e) {
  try {
    var params = {};
    if (e && e.postData && e.postData.contents) {
      try {
        params = JSON.parse(e.postData.contents);
      } catch (jsonErr) {
        return jsonResponse({ success: false, message: 'Invalid JSON payload in request' });
      }
    } else if (e && e.parameter) {
      params = e.parameter;
    }

    var action = params.action;
    if (!action || typeof action !== 'string') {
      return jsonResponse({ success: false, message: 'Valid "action" parameter is required' });
    }

    // 1. PUBLIC ACTIONS (ping and login only)
    if (action === 'ping') {
      return jsonResponse({ success: true, message: 'pong', timestamp: new Date().toISOString() });
    }

    if (action === 'login') {
      return jsonResponse(_AuthService.login(params));
    }

    // 2. AUTHENTICATION GATEWAY
    var token = params.token || params.sessionToken;
    var authCheck = _AuthService.validateSession(token);
    if (!authCheck.valid) {
      return jsonResponse({
        success: false,
        code: 401,
        message: authCheck.error || 'Unauthorized: Valid session token required'
      });
    }

    var session = authCheck.session;
    var isAdmin = session.role === (_CONFIG.ADMIN_ROLE || 'Admin');

    // 3. LABOURER ACTIONS (Permitted for self or Admin)
    switch (action) {
      case 'getEmployeeData':
        if (!isAdmin && params.employeeId && params.employeeId.toUpperCase() !== session.employeeId.toUpperCase()) {
          return jsonResponse({ success: false, code: 403, message: 'Forbidden: You cannot view data of another employee' });
        }
        params.employeeId = params.employeeId || session.employeeId;
        return jsonResponse(_AuthService.getEmployeeData(params));

      case 'startShift':
        if (!isAdmin) {
          params.employeeId = session.employeeId; // Force self
        }
        return jsonResponse(_ShiftService.startShift(params));

      case 'endShift':
        if (!isAdmin) {
          params.employeeId = session.employeeId; // Force self
        }
        return jsonResponse(_ShiftService.endShift(params));

      case 'getEmployeeShifts':
        if (!isAdmin) {
          params.employeeId = session.employeeId; // Force self
        }
        return jsonResponse({ success: true, shifts: _ShiftService.getEmployeeShifts(params.employeeId || session.employeeId) });

      case 'changePin':
        return jsonResponse(_AuthService.changePin(params, session));
    }

    // 4. ADMIN-ONLY ACTIONS (Restricted to Ateeb)
    if (!isAdmin) {
      return jsonResponse({
        success: false,
        code: 403,
        message: 'Forbidden: Admin access required for action: ' + action
      });
    }

    switch (action) {
      case 'getJobSites':
        return jsonResponse(_AdminService.getJobSites(params));
      case 'createJobSite':
        return jsonResponse(_AdminService.createJobSite(params, session));
      case 'updateJobSite':
        return jsonResponse(_AdminService.updateJobSite(params, session));
      case 'getEmployees':
        return jsonResponse(_AdminService.getEmployees(params));
      case 'createEmployee':
        return jsonResponse(_AdminService.createEmployee(params, session));
      case 'deactivateEmployee':
        return jsonResponse(_AdminService.deactivateEmployee(params, session));
      case 'getAttendance':
        return jsonResponse(_AdminService.getAttendance(params));
      case 'correctAttendance':
        return jsonResponse(_AdminService.correctAttendance(params, session));
      case 'approveOvertime':
        return jsonResponse(_OvertimeService.approveOvertime(params, session));
      case 'getPendingOvertime':
        return jsonResponse({ success: true, overtime: _OvertimeService.getPendingOvertime() });
      case 'getAllOvertime':
        return jsonResponse({ success: true, overtime: _OvertimeService.getAllOvertime() });
      case 'getAuditLogs':
        return jsonResponse(_AdminService.getAuditLogs(params));
      case 'generateDailyReport':
        return jsonResponse(_AdminService.generateDailyReport(params));
      case 'generateMonthlyReport':
        return jsonResponse(_AdminService.generateMonthlyReport(params));
      default:
        return jsonResponse({
          success: false,
          message: 'Unknown or unsupported action: ' + action
        });
    }
  } catch (error) {
    if (typeof Logger !== 'undefined') {
      Logger.log('[ERROR] doPost exception: ' + (error.stack || error.message || error));
    }
    return jsonResponse({
      success: false,
      message: 'A processing error occurred. Please try again.'
    });
  }
}

/**
 * Return JSON response formatted for Google Apps Script Web App
 */
function jsonResponse(obj) {
  if (typeof ContentService !== 'undefined') {
    return ContentService.createTextOutput(JSON.stringify(obj))
      .setMimeType(ContentService.MimeType.JSON);
  }
  return obj;
}

/**
 * Initialize spreadsheet schema — run once from script.google.com editor
 */
function init() {
  try {
    if (typeof Logger !== 'undefined') Logger.log('Initializing Labour Attendance Spreadsheet Schema...');
    var result = _SheetsService.initializeSheets();
    if (typeof Logger !== 'undefined') Logger.log('Initialization Result: ' + JSON.stringify(result));
    return result;
  } catch (err) {
    if (typeof Logger !== 'undefined') Logger.log('Initialization failed: ' + err);
    throw err;
  }
}

/**
 * Activate or update Administrator account PIN directly
 * Reads ADMIN_PIN from Project Settings -> Script Properties,
 * updates EMP000 to Active, and securely deletes the plain text property.
 * Can be run directly from the editor dropdown without altering other sheets.
 */
function activateAdmin() {
  try {
    if (typeof Logger !== 'undefined') Logger.log('Activating Administrator account EMP000...');
    var sheet = _SheetsService.getOrCreateSheet(_SHEETS ? _SHEETS.EMPLOYEES : 'Employees');
    var result = _SheetsService.seedDefaultAdmin(sheet);
    if (typeof Logger !== 'undefined') Logger.log('Activation Result: ' + JSON.stringify(result));
    return result;
  } catch (err) {
    if (typeof Logger !== 'undefined') Logger.log('Activation failed: ' + err);
    throw err;
  }
}

