const CONFIG = require('../lib/Config');
const SheetsService = require('./SheetsService');

/**
 * Authentication Service for Google Apps Script
 * Handles employee authentication with PIN verification against Google Sheets
 */
class AuthService {
  constructor() {
    this.sheets = SheetsService;
    this.maxAttempts = CONFIG.MAX_LOGIN_ATTEMPTS;
    this.lockTimeout = CONFIG.LOCK_TIMEOUT;
  }

  /**
   * Authenticate a user with employee ID and PIN
   * @param {Object} params - Request parameters
   * @returns {Object} Auth result with user data or error
   */
  login(params) {
    try {
      const { employeeId, pin } = params;
      
      if (!employeeId || !pin) {
        return this.errorResponse('Employee ID and PIN are required');
      }

      const employee = this.sheets.getEmployeeById(employeeId);
      
      if (!employee) {
        this.logAuthEvent(employeeId, 'login', 'failed', 'Employee not found');
        return this.errorResponse('Invalid Employee ID or PIN');
      }

      if (employee.Status !== 'Active') {
        this.logAuthEvent(employeeId, 'login', 'failed', 'Employee inactive');
        return this.errorResponse('Account is deactivated');
      }

      // Verify PIN - in production, compare against hash
      // For now, we store PIN hash in the sheet
      const pinHash = employee['PIN Hash'] || employee.PINHash;
      if (!this.verifyPin(pin, pinHash)) {
        this.logAuthEvent(employeeId, 'login', 'failed', 'Invalid PIN');
        return this.errorResponse('Invalid Employee ID or PIN');
      }

      // Check if account is locked
      if (this.isLocked(employee)) {
        this.logAuthEvent(employeeId, 'login', 'failed', 'Account locked');
        return this.errorResponse('Account temporarily locked. Try again later.');
      }

      // Update last accessed
      this.sheets.updateRow(CONFIG.SHEETS.EMPLOYEES, employeeId, {
        'Last Accessed': new Date().toISOString()
      });

      this.logAuthEvent(employeeId, 'login', 'success', 'Successful login');

      return {
        success: true,
        employeeId: employee.ID,
        name: employee.Name,
        role: employee.Role,
        siteId: employee['Site ID'] || employee.SiteID,
        isActive: true
      };
    } catch (error) {
      Logger.error('Auth error: ' + error.message);
      return this.errorResponse('Authentication failed');
    }
  }

  /**
   * Get employee data for session
   * @param {Object} params - Request parameters
   * @returns {Object}
   */
  getEmployeeData(params) {
    try {
      const { employeeId } = params;
      
      if (!employeeId) {
        return this.errorResponse('Employee ID required');
      }

      const employee = this.sheets.getEmployeeById(employeeId);
      
      if (!employee) {
        return this.errorResponse('Employee not found');
      }

      const site = this.sheets.getJobSiteById(employee['Site ID'] || employee.SiteID);
      
      return {
        success: true,
        employee: {
          id: employee.ID,
          name: employee.Name,
          phone: employee.Phone,
          role: employee.Role,
          siteId: employee['Site ID'] || employee.SiteID,
          siteName: site ? site.Name : 'Unknown',
          siteLat: site ? site.Latitude : null,
          siteLon: site ? site.Longitude : null,
          geofenceRadius: site ? site['Geofence Radius'] || site.GeofenceRadius : 100,
          status: employee.Status
        }
      };
    } catch (error) {
      Logger.error('Get employee data error: ' + error.message);
      return this.errorResponse('Failed to get employee data');
    }
  }

  /**
   * Verify PIN against stored hash
   * @param {string} pin - Plain text PIN
   * @param {string} storedHash - Stored hash
   * @returns {boolean}
   */
  verifyPin(pin, storedHash) {
    // In production, use proper hashing like bcrypt or PBKDF2
    // For GAS, we can use a simple hash for demo
    // TODO: Implement proper server-side PIN hashing
    const hashedPin = this.hashPin(pin);
    return hashedPin === storedHash;
  }

  /**
   * Hash PIN for storage
   * @param {string} pin
   * @returns {string}
   */
  hashPin(pin) {
    // Simple hash for demo - replace with proper crypto in production
    // Using Utilities.computeDigest for GAS compatibility
    const hash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, pin + 'salt_' + pin.length);
    return Utilities.base64Encode(hash);
  }

  /**
   * Check if account is locked due to failed attempts
   * @param {Object} employee
   * @returns {boolean}
   */
  isLocked(employee) {
    // In a full implementation, track failed attempts in a separate sheet
    // For now, return false
    return false;
  }

  /**
   * Log authentication event to audit log
   * @param {string} employeeId
   * @param {string} action
   * @param {string} outcome
   * @param {string} details
   */
  logAuthEvent(employeeId, action, outcome, details) {
    try {
      const auditId = this.sheets.generateAuditId();
      const auditData = {
        ID: auditId,
        'Employee ID': employeeId,
        Action: action,
        Outcome: outcome,
        Timestamp: new Date().toISOString(),
        'Performed By': 'system',
        Details: details
      };
      this.sheets.appendRow(CONFIG.SHEETS.AUDIT_LOGS, auditData);
    } catch (error) {
      Logger.error('Failed to log auth event: ' + error.message);
    }
  }

  /**
   * Create error response
   * @param {string} message
   * @returns {Object}
   */
  errorResponse(message) {
    return {
      success: false,
      message: message
    };
  }
}

module.exports = new AuthService();