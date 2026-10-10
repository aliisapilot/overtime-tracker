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
      var lat = parseFloat(params.lat != null ? params.lat : params.latitude);
      var lon = parseFloat(params.lon != null ? params.lon : (params.longitude != null ? params.longitude : params.lng));
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

      // Check assigned job site
      var siteId = (employee['Site ID'] || employee.SiteID || employee.siteId || '').toString().trim();
      if (!siteId || siteId === 'FIELD' || siteId === 'Unassigned') {
        return { 
          success: false, 
          code: 400,
          message: 'No job site assigned. Please contact your supervisor.' 
        };
      }

      // Verify site exists in Job Sites
      var site = _SheetsService.getJobSiteById(siteId);
      if (!site) {
        return { 
          success: false, 
          code: 404,
          message: 'Assigned job site (' + siteId + ') was not found. Please contact your supervisor.' 
        };
      }

      // Check if employee already has an active shift (duplicate prevention)
      var activeShift = this.getActiveShift(employeeId);
      if (activeShift) {
        return { 
          success: false, 
          message: 'You already have an active shift started at ' + activeShift['Start Time'] + '. Please end that shift before starting a new one.',
          activeShift: activeShift
        };
      }

      // Validate location and geofence
      if (_LocationService) {
        var locValidation = _LocationService.validateLocation({
          lat: lat,
          lon: lon,
          accuracy: accuracy,
          siteId: siteId
        });
        if (!locValidation.valid) {
          return {
            success: false,
            code: 403,
            message: locValidation.message || locValidation.error,
            distance: locValidation.distance,
            geofenceRadius: locValidation.geofenceRadius
          };
        }
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
      this.logAudit(employeeId, 'start_shift', 'success', 'Started shift ' + shiftId + ' at site ' + siteId + ' (GPS: ' + lat + ', ' + lon + ')');

      return {
        success: true,
        shiftId: shiftId,
        startTime: serverStartTime,
        siteId: siteId,
        siteName: site.Name,
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
      var lat = parseFloat(params.lat != null ? params.lat : params.latitude);
      var lon = parseFloat(params.lon != null ? params.lon : (params.longitude != null ? params.longitude : params.lng));
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

  /**
   * Get combined dashboard data for a labourer in a single GAS call.
   * Returns employee profile, job site details, all shifts, and the active shift.
   * Leverages the in-request sheet cache so Employees, Job Sites, and Shifts are
   * each read from Google Sheets at most once per request.
   * @param {Object} params - { employeeId }
   * @returns {Object}
   */
  ShiftServiceClass.prototype.getDashboardData = function(params) {
    try {
      var employeeId = (params.employeeId || '').trim().toUpperCase();
      if (!employeeId) {
        return { success: false, message: 'Employee ID is required' };
      }

      // Single read of Employees sheet (cached for subsequent lookups)
      var employee = _SheetsService.getEmployeeById(employeeId);
      if (!employee) {
        return { success: false, message: 'Employee not found' };
      }

      var siteId = (employee['Site ID'] || employee.SiteID || '').toString().trim();
      // Single read of Job Sites sheet (cached)
      var site = siteId ? _SheetsService.getJobSiteById(siteId) : null;

      var employeeProfile = {
        id: employee.ID,
        name: employee.Name,
        phone: employee.Phone || '',
        role: employee.Role || 'Labourer',
        siteId: siteId,
        siteName: site ? site.Name : (siteId ? 'Unknown Site (' + siteId + ')' : 'Unassigned'),
        siteLat: site ? parseFloat(site.Latitude) : null,
        siteLon: site ? parseFloat(site.Longitude) : null,
        geofenceRadius: site
          ? parseFloat(site['Geofence Radius'] || site.GeofenceRadius || _CONFIG.DEFAULT_GEOFENCE_RADIUS || 100)
          : (_CONFIG.DEFAULT_GEOFENCE_RADIUS || 100),
        status: employee.Status
      };

      // Single read of Shifts sheet (cached)
      var allShifts = _SheetsService.getAllShifts();
      var employeeShifts = allShifts.filter(function(s) {
        return String(s['Employee ID']) === employeeId;
      });

      var activeShift = null;
      for (var i = 0; i < employeeShifts.length; i++) {
        if (employeeShifts[i].Status === 'Active') {
          activeShift = employeeShifts[i];
          break;
        }
      }

      return {
        success: true,
        employee: employeeProfile,
        jobSite: site ? {
          id: site.ID,
          name: site.Name,
          address: site.Address || '',
          lat: parseFloat(site.Latitude),
          lon: parseFloat(site.Longitude),
          geofenceRadius: parseFloat(site['Geofence Radius'] || site.GeofenceRadius || _CONFIG.DEFAULT_GEOFENCE_RADIUS || 100),
          status: site.Status
        } : null,
        shifts: employeeShifts,
        activeShift: activeShift
      };
    } catch (err) {
      if (typeof Logger !== 'undefined') Logger.log('getDashboardData error: ' + err);
      return { success: false, message: 'Failed to load dashboard data: ' + (err.message || err) };
    }
  };

  return new ShiftServiceClass();
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ShiftService;
}