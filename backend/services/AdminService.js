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
      var lat = parseFloat(params.lat);
      var lon = parseFloat(params.lon);
      var geofenceRadius = parseFloat(params.geofenceRadius || _CONFIG.DEFAULT_GEOFENCE_RADIUS || 100);

      if (!name) {
        return { success: false, message: 'Job site name is required' };
      }
      if (isNaN(lat) || isNaN(lon)) {
        return { success: false, message: 'Valid latitude and longitude coordinates are required' };
      }

      var siteId = _SheetsService.generateSiteId();
      var siteData = {
        ID: siteId,
        Name: name,
        Address: address,
        Latitude: lat,
        Longitude: lon,
        'Geofence Radius': geofenceRadius,
        Status: 'Active',
        'Created At': new Date().toISOString()
      };

      _SheetsService.appendRow(_SHEETS.JOB_SITES, siteData);
      var adminName = session ? session.name : 'Admin';
      this.logAudit('SYSTEM', 'create_job_site', 'success', 'Created site ' + siteId + ': ' + name + ' (' + lat + ', ' + lon + ')', adminName);

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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = AdminService;
}