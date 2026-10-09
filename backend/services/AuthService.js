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
      if (!employee && /^\d+$/.test(employeeId)) {
        var paddedId = 'EMP' + ('000' + employeeId).slice(-3);
        var fallbackEmployee = _SheetsService.getEmployeeById(paddedId);
        if (fallbackEmployee) {
          employee = fallbackEmployee;
          employeeId = paddedId;
        }
      }

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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = AuthService;
}