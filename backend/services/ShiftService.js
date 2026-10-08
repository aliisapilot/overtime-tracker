const CONFIG = require('../lib/Config');
const SheetsService = require('./SheetsService');
const LocationService = require('./LocationService');

/**
 * Shift Service
 * Handles shift start, end, and overtime calculations
 */
class ShiftService {
  constructor() {
    this.sheets = SheetsService;
    this.location = LocationService;
    this.regularHours = parseFloat(CONFIG.DEFAULT_REGULAR_HOURS);
    this.breakDuration = parseFloat(CONFIG.DEFAULT_BREAK_DURATION);
  }

  /**
   * Start a new shift
   * @param {Object} params - Request parameters
   * @returns {Object} Shift start result
   */
  startShift(params) {
    try {
      const { employeeId, lat, lon, accuracy } = params;
      
      if (!employeeId) {
        return this.errorResponse('Employee ID required');
      }

      // Get employee data
      const employee = this.sheets.getEmployeeById(employeeId);
      if (!employee) {
        return this.errorResponse('Employee not found');
      }

      if (employee.Status !== 'Active') {
        return this.errorResponse('Employee is not active');
      }

      const siteId = employee['Site ID'] || employee.SiteID;
      if (!siteId) {
        return this.errorResponse('Employee not assigned to a site');
      }

      // Validate location
      const locationValidation = this.location.validateLocation({
        lat: parseFloat(lat),
        lon: parseFloat(lon),
        accuracy: parseFloat(accuracy),
        siteId
      });

      if (!locationValidation.valid) {
        return {
          success: false,
          message: 'Location validation failed: ' + locationValidation.message,
          accuracy: locationValidation.accuracy,
          distance: locationValidation.distance
        };
      }

      // Check for existing active shift
      const activeShift = this.getActiveShift(employeeId);
      if (activeShift) {
        return this.errorResponse('Employee already has an active shift');
      }

      // Create new shift
      const shiftId = this.sheets.generateShiftId();
      const startTime = new Date().toISOString();
      
      const shiftData = {
        ID: shiftId,
        'Employee ID': employeeId,
        'Site ID': siteId,
        'Start Time': startTime,
        'End Time': '',
        'Start Latitude': lat,
        'Start Longitude': lon,
        'Start Accuracy': accuracy,
        'End Latitude': '',
        'End Longitude': '',
        'End Accuracy': '',
        'Break Minutes': this.breakDuration,
        'Regular Hours': 0,
        'Overtime Hours': 0,
        Status: 'Active',
        'Created At': startTime
      };

      this.sheets.appendRow(CONFIG.SHEETS.SHIFTS, shiftData);

      // Log audit event
      this.logAudit(employeeId, 'Start Shift', 'success', `Started shift ${shiftId} at site ${siteId}`);

      return {
        success: true,
        shiftId,
        startTime,
        siteId,
        message: 'Shift started successfully'
      };
    } catch (error) {
      Logger.error('Start shift error: ' + error.message);
      return this.errorResponse('Failed to start shift');
    }
  }

  /**
   * End an active shift
   * @param {Object} params - Request parameters
   * @returns {Object} Shift end result with overtime calculation
   */
  endShift(params) {
    try {
      const { employeeId, lat, lon, accuracy } = params;
      
      if (!employeeId) {
        return this.errorResponse('Employee ID required');
      }

      // Find active shift
      const activeShift = this.getActiveShift(employeeId);
      if (!activeShift) {
        return this.errorResponse('No active shift found');
      }

      const siteId = activeShift['Site ID'];
      
      // Validate location
      const locationValidation = this.location.validateLocation({
        lat: parseFloat(lat),
        lon: parseFloat(lon),
        accuracy: parseFloat(accuracy),
        siteId
      });

      if (!locationValidation.valid) {
        return {
          success: false,
          message: 'Location validation failed: ' + locationValidation.message,
          accuracy: locationValidation.accuracy,
          distance: locationValidation.distance
        };
      }

      const endTime = new Date().toISOString();
      
      // Calculate hours
      const { regularHours, overtimeHours, totalHours } = this.calculateHours(
        activeShift['Start Time'],
        endTime,
        activeShift['Break Minutes']
      );

      // Update shift record
      const updateData = {
        'End Time': endTime,
        'End Latitude': lat,
        'End Longitude': lon,
        'End Accuracy': accuracy,
        'Regular Hours': regularHours,
        'Overtime Hours': overtimeHours,
        Status: 'Completed'
      };

      this.sheets.updateRow(CONFIG.SHEETS.SHIFTS, activeShift.ID, updateData);

      // If overtime, create overtime record
      if (overtimeHours > 0) {
        this.createOvertimeRecord(activeShift.ID, employeeId, endTime, overtimeHours);
      }

      // Log audit event
      this.logAudit(employeeId, 'End Shift', 'success', 
        `Ended shift ${activeShift.ID}. Hours: ${totalHours.toFixed(2)} (Reg: ${regularHours}, OT: ${overtimeHours})`);

      return {
        success: true,
        shiftId: activeShift.ID,
        endTime,
        regularHours,
        overtimeHours,
        totalHours,
        message: 'Shift ended successfully'
      };
    } catch (error) {
      Logger.error('End shift error: ' + error.message);
      return this.errorResponse('Failed to end shift');
    }
  }

  /**
   * Get active shift for employee
   * @param {string} employeeId
   * @returns {Object|null}
   */
  getActiveShift(employeeId) {
    const shifts = this.sheets.getAllShifts();
    return shifts.find(s => s['Employee ID'] === employeeId && s.Status === 'Active') || null;
  }

  /**
   * Calculate regular and overtime hours
   * @param {string} startTime
   * @param {string} endTime
   * @param {number} breakMinutes
   * @returns {Object} Hours breakdown
   */
  calculateHours(startTime, endTime, breakMinutes) {
    const start = new Date(startTime);
    const end = new Date(endTime);
    
    // Handle overnight shifts
    let totalMs = end - start;
    if (totalMs < 0) {
      totalMs += 24 * 60 * 60 * 1000; // Add 24 hours for overnight
    }
    
    const totalHours = totalMs / (1000 * 60 * 60);
    const workedHours = totalHours - (breakMinutes / 60);
    
    const regularHours = Math.min(workedHours, this.regularHours);
    const overtimeHours = Math.max(0, workedHours - this.regularHours);
    
    return {
      totalHours: Math.max(0, workedHours),
      regularHours: Math.round(regularHours * 100) / 100,
      overtimeHours: Math.round(overtimeHours * 100) / 100
    };
  }

  /**
   * Create overtime record
   * @param {string} shiftId
   * @param {string} employeeId
   * @param {string} date
   * @param {number} overtimeHours
   */
  createOvertimeRecord(shiftId, employeeId, date, overtimeHours) {
    const otId = this.sheets.generateOvertimeId();
    const otData = {
      ID: otId,
      'Shift ID': shiftId,
      'Employee ID': employeeId,
      Date: new Date(date).toISOString().split('T')[0],
      'Overtime Hours': overtimeHours,
      'Approval Status': 'Pending',
      'Approved By': '',
      'Approved At': '',
      'Created At': new Date().toISOString()
    };
    this.sheets.appendRow(CONFIG.SHEETS.OVERTIME, otData);
  }

  /**
   * Get shifts for employee
   * @param {string} employeeId
   * @returns {Object[]}
   */
  getEmployeeShifts(employeeId) {
    const shifts = this.sheets.getAllShifts();
    return shifts.filter(s => s['Employee ID'] === employeeId);
  }

  /**
   * Get all shifts
   * @returns {Object[]}
   */
  getAllShifts() {
    return this.sheets.getAllShifts();
  }

  /**
   * Log audit event
   * @param {string} employeeId
   * @param {string} action
   * @param {string} outcome
   * @param {string} details
   */
  logAudit(employeeId, action, outcome, details) {
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
      Logger.error('Failed to log audit: ' + error.message);
    }
  }

  errorResponse(message) {
    return { success: false, message };
  }
}

module.exports = new ShiftService();