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

var _ShiftService = (typeof ShiftService !== 'undefined')
  ? ShiftService
  : (typeof require !== 'undefined' ? require('./ShiftService') : null);

var _OvertimeService = (typeof OvertimeService !== 'undefined')
  ? OvertimeService
  : (typeof require !== 'undefined' ? require('./OvertimeService') : null);

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
        site: siteData,
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

      var updatedSite = Object.assign({}, existingSite, updateData);
      return {
        success: true,
        siteId: siteId,
        site: updatedSite,
        jobSite: updatedSite,
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
      var siteId = (params.siteId || params.assignedSiteId || params['Site ID'] || '').toString().trim();
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
        if (site.Status === 'Archived') {
          return { success: false, message: 'Cannot assign employee to an archived job site (' + site.Name + ')' };
        }
      }

      var customId = (params.employeeId || params.id || '').trim().toUpperCase();
      var employeeId;
      if (customId) {
        var existing = _SheetsService.getEmployeeById(customId);
        if (existing) {
          return { success: false, message: 'Employee ID ' + customId + ' is already in use' };
        }
        employeeId = customId;
      } else {
        employeeId = _SheetsService.generateEmployeeId();
      }

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
      this.logAudit(employeeId, 'create_employee', 'success', 'Created employee ' + employeeId + ' (' + name + ', role: ' + role + (siteId ? ', site: ' + siteId : '') + ')', adminName);

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
   * Update an existing employee (ID, Name, Phone, Role, Site, Status, or PIN)
   */
  AdminServiceClass.prototype.updateEmployee = function(params, session) {
    try {
      var currentId = (params.currentId || params.employeeId || params.id || '').trim().toUpperCase();
      if (!currentId) {
        return { success: false, message: 'Current Employee ID is required' };
      }

      var employee = _SheetsService.getEmployeeById(currentId);
      if (!employee) {
        return { success: false, message: 'Employee not found: ' + currentId };
      }

      var newId = (params.newId || params.newEmployeeId || '').trim().toUpperCase();
      var name = (params.name != null ? params.name : employee.Name).trim();
      var phone = (params.phone != null ? params.phone : employee.Phone).trim();
      var role = (params.role != null ? params.role : employee.Role).trim();
      var rawSiteId = params.siteId !== undefined ? params.siteId : (params.assignedSiteId !== undefined ? params.assignedSiteId : params['Site ID']);
      var siteId = rawSiteId !== undefined ? (rawSiteId || '').toString().trim() : (employee['Site ID'] || employee.SiteID || '');
      var status = (params.status != null ? params.status : employee.Status).trim();

      if (!name) {
        return { success: false, message: 'Employee name is required' };
      }

      if (siteId) {
        var site = _SheetsService.getJobSiteById(siteId);
        if (!site) {
          return { success: false, message: 'Selected job site (' + siteId + ') does not exist' };
        }
        if (site.Status === 'Archived') {
          return { success: false, message: 'Cannot assign employee to an archived job site (' + site.Name + ')' };
        }
      }

      // Security check: Protect the last active administrator from being deactivated or archived
      if (employee.Role === (_CONFIG.ADMIN_ROLE || 'Admin') || currentId === 'EMP000') {
        if (status === 'Inactive' || status === 'Archived') {
          var allEmps = _SheetsService.getAllEmployees();
          var remainingAdmins = allEmps.filter(function(e) {
            return e.Role === (_CONFIG.ADMIN_ROLE || 'Admin') && e.Status === 'Active' && e.ID !== currentId;
          });
          if (remainingAdmins.length === 0) {
            return { success: false, message: 'Security restriction: Cannot deactivate or archive the last active administrator (' + currentId + ').' };
          }
        }
      }

      if (newId && newId !== currentId) {
        var existing = _SheetsService.getEmployeeById(newId);
        if (existing) {
          return { success: false, message: 'New Employee ID ' + newId + ' is already in use' };
        }
      }

      var updateData = {
        Name: name,
        Phone: phone,
        Role: role,
        'Site ID': siteId,
        Status: status
      };

      if (newId && newId !== currentId) {
        updateData.ID = newId;
      }

      if (params.pin && String(params.pin).trim().length >= 4) {
        updateData['PIN Hash'] = _CryptoUtils.hashPin(String(params.pin).trim());
      }

      var updated = _SheetsService.updateRow(_SHEETS.EMPLOYEES, currentId, updateData);
      if (!updated) {
        return { success: false, message: 'Failed to update employee' };
      }

      var finalEmpId = newId || currentId;
      var updatedEmp = _SheetsService.getEmployeeById(finalEmpId);

      var adminName = session ? session.name : 'Admin';
      this.logAudit(finalEmpId, 'update_employee', 'success', 'Updated employee ' + currentId + (newId && newId !== currentId ? ' (renamed to ' + newId + ')' : '') + (siteId ? ' (site: ' + siteId + ')' : ''), adminName);

      return {
        success: true,
        employeeId: finalEmpId,
        employee: updatedEmp ? {
          id: updatedEmp.ID,
          name: updatedEmp.Name,
          phone: updatedEmp.Phone || '',
          role: updatedEmp.Role || 'Labourer',
          siteId: updatedEmp['Site ID'] || updatedEmp.SiteID || '',
          status: updatedEmp.Status || 'Active'
        } : null,
        message: 'Employee updated successfully'
      };
    } catch (error) {
      return { success: false, message: 'Failed to update employee: ' + (error.message || error) };
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

      // Security check: Protect default admin and last active admin
      if (employeeId === 'EMP000') {
        return { success: false, message: 'Security restriction: Cannot deactivate the default administrator account (EMP000).' };
      }

      var targetEmp = _SheetsService.getEmployeeById(employeeId);
      if (targetEmp && targetEmp.Role === (_CONFIG.ADMIN_ROLE || 'Admin') && (status === 'Inactive' || status === 'Archived')) {
        var allEmps = _SheetsService.getAllEmployees();
        var remainingAdmins = allEmps.filter(function(e) {
          return e.Role === (_CONFIG.ADMIN_ROLE || 'Admin') && e.Status === 'Active' && e.ID !== employeeId;
        });
        if (remainingAdmins.length === 0) {
          return { success: false, message: 'Security restriction: Cannot deactivate or archive the last active administrator.' };
        }
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
        var hasStartPhoto = Boolean(s['Start Photo Key']);
        var hasEndPhoto = Boolean(s['End Photo Key']);
        var isCompleted = s.Status === 'Completed';

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
          status: s.Status,
          voidReason: s['Void Reason'] || '',
          voidedAt: s['Voided At'] || '',
          voidedBy: s['Voided By'] || '',
          startPhotoKey: s['Start Photo Key'] || '',
          startPhotoCapturedAt: s['Start Photo Captured At'] || '',
          startPhotoStatus: hasStartPhoto ? (s['Start Photo Verification Status'] || 'Verified') : 'Legacy Record',
          endPhotoKey: s['End Photo Key'] || '',
          endPhotoCapturedAt: s['End Photo Captured At'] || '',
          endPhotoStatus: hasEndPhoto ? (s['End Photo Verification Status'] || 'Verified') : (isCompleted ? 'Legacy Record' : 'Pending')
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

      var sheet = _SheetsService.getOrCreateSheet(_SHEETS.AUDIT_LOGS);
      var logs;
      if (!sheet || _SheetsService._mockData) {
        logs = _SheetsService.getAllRows(_SHEETS.AUDIT_LOGS);
      } else {
        var lastRow = sheet.getLastRow();
        if (lastRow <= 1) {
          logs = [];
        } else if (lastRow > (limit * 2) + 1 && !employeeId) {
          // Bounded tail read: audit logs are strictly append-only, read only the last limit * 2 rows
          var startRow = Math.max(2, lastRow - (limit * 2) + 1);
          var numRows = lastRow - startRow + 1;
          var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
          var values = sheet.getRange(startRow, 1, numRows, headers.length).getValues();
          logs = values.map(function(row) {
            var obj = {};
            headers.forEach(function(h, i) { if (h) obj[h] = row[i]; });
            return obj;
          });
        } else {
          logs = _SheetsService.getAllRows(_SHEETS.AUDIT_LOGS);
        }
      }

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
        if (!s['Start Time'] || s.Status === 'Voided') return false;
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
        if (!s['Start Time'] || s.Status === 'Voided') return false;
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

  /**
   * Combined Admin Dashboard Data Endpoint
   * Returns workforce, job sites, pending overtime, and active shift counts in a single call.
   * Significantly reduces round-trips and eliminates cold-start timeouts from parallel requests.
   */
  AdminServiceClass.prototype.getAdminDashboardData = function(params) {
    try {
      var employees = _SheetsService.getAllEmployees();
      var jobSites = _SheetsService.getAllJobSites();
      var shifts = _SheetsService.getAllShifts();
      var overtime = _SheetsService.getAllOvertime();

      var pendingOvertime = overtime.filter(function(o) {
        var st = (o['Approval Status'] || o.ApprovalStatus);
        return st === 'Pending';
      });

      var activeShifts = shifts.filter(function(s) {
        return (s.Status === 'Active' || !s['End Time']) && s.Status !== 'Voided';
      });

      var todayStr = new Date().toISOString().split('T')[0];
      var todayShifts = shifts.filter(function(s) {
        return s['Start Time'] && s['Start Time'].indexOf(todayStr) === 0 && s.Status !== 'Voided';
      });

      var activeEmployees = employees.filter(function(e) { return e.Status !== 'Archived'; });

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
            lastAccessed: e['Last Accessed'] || '',
            archivedAt: e['Archived At'] || '',
            archivedBy: e['Archived By'] || '',
            archiveReason: e['Archive Reason'] || ''
          };
        }),
        jobSites: jobSites.map(function(s) {
          return {
            id: s.ID,
            name: s.Name,
            address: s.Address || '',
            lat: s.Latitude ? parseFloat(s.Latitude) : null,
            lon: s.Longitude ? parseFloat(s.Longitude) : null,
            geofenceRadius: s['Geofence Radius'] ? parseFloat(s['Geofence Radius']) : (_CONFIG.DEFAULT_GEOFENCE_RADIUS || 100),
            status: s.Status || 'Active',
            archivedAt: s['Archived At'] || '',
            archivedBy: s['Archived By'] || '',
            archiveReason: s['Archive Reason'] || ''
          };
        }),
        pendingOvertime: pendingOvertime,
        activeShiftsCount: activeShifts.length,
        todayShiftsCount: todayShifts.length,
        totalEmployeesCount: activeEmployees.length,
        archivedCount: (employees.length - activeEmployees.length) + jobSites.filter(function(s) { return s.Status === 'Archived'; }).length
      };
    } catch (error) {
      return { success: false, message: 'Failed to load admin dashboard data: ' + (error.message || error) };
    }
  };

  /**
   * Archive employee (soft delete with historical data preservation)
   */
  AdminServiceClass.prototype.archiveEmployee = function(params, session) {
    try {
      var employeeId = (params.employeeId || params.id || '').trim().toUpperCase();
      var reason = (params.reason || params.archiveReason || '').trim();

      if (!employeeId) {
        return { success: false, message: 'Employee ID is required' };
      }

      var employee = _SheetsService.getEmployeeById(employeeId);
      if (!employee) {
        return { success: false, message: 'Employee not found: ' + employeeId };
      }

      if (employee.Status === 'Archived') {
        return { success: false, message: 'Employee ' + employeeId + ' is already archived.' };
      }

      // Security check: Prevent archiving the last active administrator
      if (employee.Role === (_CONFIG.ADMIN_ROLE || 'Admin') || employeeId === 'EMP000') {
        var allEmps = _SheetsService.getAllEmployees();
        var remainingAdmins = allEmps.filter(function(e) {
          return e.Role === (_CONFIG.ADMIN_ROLE || 'Admin') && e.Status === 'Active' && e.ID !== employeeId;
        });
        if (remainingAdmins.length === 0) {
          return { success: false, message: 'Security restriction: Cannot archive the last active administrator (' + employeeId + ').' };
        }
      }

      // Security check: Block archiving if employee has an active clocked-in shift
      var activeShift = _ShiftService ? _ShiftService.getActiveShift(employeeId) : null;
      if (activeShift) {
        return { 
          success: false, 
          message: 'Cannot archive employee ' + employeeId + ' while an active shift (' + activeShift.ID + ') is clocked in. End or void the shift first.' 
        };
      }

      var timestamp = new Date().toISOString();
      var adminName = session ? session.name : 'Ateeb (Admin)';

      var updated = _SheetsService.updateRow(_SHEETS.EMPLOYEES, employeeId, {
        Status: 'Archived',
        'Archived At': timestamp,
        'Archived By': adminName,
        'Archive Reason': reason || 'Archived by administrator'
      });

      if (!updated) {
        return { success: false, message: 'Failed to archive employee in database' };
      }

      this.logAudit(employeeId, 'archive_employee', 'success', 'Archived employee ' + employeeId + ' (' + employee.Name + '). Reason: ' + (reason || 'None specified'), adminName);

      return {
        success: true,
        employeeId: employeeId,
        status: 'Archived',
        archivedAt: timestamp,
        archivedBy: adminName,
        message: 'Employee ' + employee.Name + ' (' + employeeId + ') archived successfully'
      };
    } catch (error) {
      return { success: false, message: 'Failed to archive employee: ' + (error.message || error) };
    }
  };

  /**
   * Restore archived employee to Active status
   */
  AdminServiceClass.prototype.restoreEmployee = function(params, session) {
    try {
      var employeeId = (params.employeeId || params.id || '').trim().toUpperCase();

      if (!employeeId) {
        return { success: false, message: 'Employee ID is required' };
      }

      var employee = _SheetsService.getEmployeeById(employeeId);
      if (!employee) {
        return { success: false, message: 'Employee not found: ' + employeeId };
      }

      if (employee.Status !== 'Archived') {
        return { success: false, message: 'Employee ' + employeeId + ' is not archived (current status: ' + employee.Status + ').' };
      }

      var timestamp = new Date().toISOString();
      var adminName = session ? session.name : 'Ateeb (Admin)';

      var updated = _SheetsService.updateRow(_SHEETS.EMPLOYEES, employeeId, {
        Status: 'Active',
        'Restored At': timestamp,
        'Restored By': adminName
      });

      if (!updated) {
        return { success: false, message: 'Failed to restore employee in database' };
      }

      this.logAudit(employeeId, 'restore_employee', 'success', 'Restored employee ' + employeeId + ' (' + employee.Name + ') to Active status', adminName);

      return {
        success: true,
        employeeId: employeeId,
        status: 'Active',
        restoredAt: timestamp,
        restoredBy: adminName,
        message: 'Employee ' + employee.Name + ' (' + employeeId + ') restored to Active status'
      };
    } catch (error) {
      return { success: false, message: 'Failed to restore employee: ' + (error.message || error) };
    }
  };

  /**
   * Archive job site (soft delete, prevents new assignments and active shifts)
   */
  AdminServiceClass.prototype.archiveJobSite = function(params, session) {
    try {
      var siteId = (params.siteId || params.id || '').trim();
      var reason = (params.reason || params.archiveReason || '').trim();

      if (!siteId) {
        return { success: false, message: 'Job site ID is required' };
      }

      var site = _SheetsService.getJobSiteById(siteId);
      if (!site) {
        return { success: false, message: 'Job site not found: ' + siteId };
      }

      if (site.Status === 'Archived') {
        return { success: false, message: 'Job site ' + siteId + ' is already archived.' };
      }

      // Check active shifts currently on this site
      var allShifts = _SheetsService.getAllShifts();
      var activeOnSite = allShifts.filter(function(s) {
        return String(s['Site ID']) === siteId && (s.Status === 'Active' || !s['End Time']);
      });

      if (activeOnSite.length > 0) {
        return {
          success: false,
          message: 'Cannot archive site ' + site.Name + ' (' + siteId + '): there are ' + activeOnSite.length + ' active shift(s) currently clocked in. End all shifts first.'
        };
      }

      var timestamp = new Date().toISOString();
      var adminName = session ? session.name : 'Ateeb (Admin)';

      var updated = _SheetsService.updateRow(_SHEETS.JOB_SITES, siteId, {
        Status: 'Archived',
        'Archived At': timestamp,
        'Archived By': adminName,
        'Archive Reason': reason || 'Archived by administrator'
      });

      if (!updated) {
        return { success: false, message: 'Failed to archive job site in database' };
      }

      this.logAudit('SYSTEM', 'archive_job_site', 'success', 'Archived job site ' + siteId + ' (' + site.Name + '). Reason: ' + (reason || 'None specified'), adminName);

      return {
        success: true,
        siteId: siteId,
        status: 'Archived',
        archivedAt: timestamp,
        archivedBy: adminName,
        message: 'Job site ' + site.Name + ' (' + siteId + ') archived successfully'
      };
    } catch (error) {
      return { success: false, message: 'Failed to archive job site: ' + (error.message || error) };
    }
  };

  /**
   * Restore archived job site to Active status
   */
  AdminServiceClass.prototype.restoreJobSite = function(params, session) {
    try {
      var siteId = (params.siteId || params.id || '').trim();

      if (!siteId) {
        return { success: false, message: 'Job site ID is required' };
      }

      var site = _SheetsService.getJobSiteById(siteId);
      if (!site) {
        return { success: false, message: 'Job site not found: ' + siteId };
      }

      if (site.Status !== 'Archived') {
        return { success: false, message: 'Job site ' + siteId + ' is not archived (current status: ' + site.Status + ').' };
      }

      var timestamp = new Date().toISOString();
      var adminName = session ? session.name : 'Ateeb (Admin)';

      var updated = _SheetsService.updateRow(_SHEETS.JOB_SITES, siteId, {
        Status: 'Active',
        'Restored At': timestamp,
        'Restored By': adminName
      });

      if (!updated) {
        return { success: false, message: 'Failed to restore job site in database' };
      }

      this.logAudit('SYSTEM', 'restore_job_site', 'success', 'Restored job site ' + siteId + ' (' + site.Name + ') to Active status', adminName);

      return {
        success: true,
        siteId: siteId,
        status: 'Active',
        restoredAt: timestamp,
        restoredBy: adminName,
        message: 'Job site ' + site.Name + ' (' + siteId + ') restored to Active status'
      };
    } catch (error) {
      return { success: false, message: 'Failed to restore job site: ' + (error.message || error) };
    }
  };

  /**
   * Void shift / attendance record with mandatory reason
   */
  AdminServiceClass.prototype.voidShift = function(params, session) {
    try {
      var shiftId = (params.shiftId || params.id || '').trim();
      var reason = (params.reason || params.voidReason || '').trim();

      if (!shiftId) {
        return { success: false, message: 'Shift ID is required' };
      }

      if (!reason) {
        return { success: false, message: 'A mandatory reason is required to void attendance records.' };
      }

      var shift = _SheetsService.findById(_SHEETS.SHIFTS, shiftId);
      if (!shift) {
        return { success: false, message: 'Shift not found: ' + shiftId };
      }

      if (shift.Status === 'Voided') {
        return { success: false, message: 'Shift ' + shiftId + ' is already voided.' };
      }

      var timestamp = new Date().toISOString();
      var adminName = session ? session.name : 'Ateeb (Admin)';

      var updated = _SheetsService.updateRow(_SHEETS.SHIFTS, shiftId, {
        Status: 'Voided',
        'Void Reason': reason,
        'Voided At': timestamp,
        'Voided By': adminName
      });

      if (!updated) {
        return { success: false, message: 'Failed to void shift in database' };
      }

      // Automatically cancel any associated pending or generated overtime records for this shift
      var allOt = _SheetsService.getAllOvertime();
      var linkedOt = allOt.filter(function(o) { return String(o['Shift ID']) === shiftId; });
      linkedOt.forEach(function(o) {
        _SheetsService.updateRow(_SHEETS.OVERTIME, o.ID, {
          'Approval Status': 'Cancelled',
          'Void Reason': 'Associated shift ' + shiftId + ' voided: ' + reason,
          'Voided At': timestamp,
          'Voided By': adminName
        });
      });

      var details = 'Voided shift ' + shiftId + ' (Employee: ' + shift['Employee ID'] + ', Reg: ' + (shift['Regular Hours'] || 0) + 'h, OT: ' + (shift['Overtime Hours'] || 0) + 'h). Reason: ' + reason;
      this.logAudit(shift['Employee ID'], 'void_shift', 'success', details, adminName);

      return {
        success: true,
        shiftId: shiftId,
        status: 'Voided',
        voidReason: reason,
        voidedAt: timestamp,
        voidedBy: adminName,
        message: 'Shift ' + shiftId + ' voided successfully'
      };
    } catch (error) {
      return { success: false, message: 'Failed to void shift: ' + (error.message || error) };
    }
  };

  /**
   * Purge uploaded attendance photo under strict retention/privacy policy
   */
  AdminServiceClass.prototype.purgeAttendancePhoto = function(params, session) {
    try {
      var shiftId = (params.shiftId || '').trim();
      var photoType = (params.photoType === 'end') ? 'end' : 'start';
      var reason = (params.reason || '').trim();
      var policyAck = Boolean(params.policyAck);

      if (!shiftId) {
        return { success: false, message: 'Shift ID is required' };
      }

      if (!reason || !policyAck) {
        return {
          success: false,
          message: 'Mandatory reason and retention policy acknowledgement are required to purge attendance photos.'
        };
      }

      var shift = _SheetsService.findById(_SHEETS.SHIFTS, shiftId);
      if (!shift) {
        return { success: false, message: 'Shift not found: ' + shiftId };
      }

      var timestamp = new Date().toISOString();
      var adminName = session ? session.name : 'Ateeb (Admin)';
      var keyField = photoType === 'end' ? 'End Photo Key' : 'Start Photo Key';
      var statusField = photoType === 'end' ? 'End Photo Verification Status' : 'Start Photo Verification Status';
      var oldKey = shift[keyField] || '';

      if (!oldKey) {
        return { success: false, message: 'No ' + photoType + ' photo found for shift ' + shiftId };
      }

      var updateData = {};
      updateData[keyField] = '';
      updateData[statusField] = 'Purged (' + timestamp.split('T')[0] + ' by ' + adminName + ': ' + reason + ')';

      _SheetsService.updateRow(_SHEETS.SHIFTS, shiftId, updateData);

      this.logAudit(shift['Employee ID'], 'purge_photo', 'success',
        'Purged ' + photoType + ' photo for shift ' + shiftId + ' under retention policy. Reason: ' + reason, adminName);

      return {
        success: true,
        shiftId: shiftId,
        photoKey: oldKey,
        photoType: photoType,
        message: 'Attendance photo purged successfully under retention policy'
      };
    } catch (error) {
      return { success: false, message: 'Failed to purge attendance photo: ' + (error.message || error) };
    }
  };

  /**
   * Get all archived and voided records across the application with duplicate detection
   */
  AdminServiceClass.prototype.getArchivedRecords = function(params, session) {
    try {
      var allEmployees = _SheetsService.getAllEmployees();
      var allSites = _SheetsService.getAllJobSites();
      var allShifts = _SheetsService.getAllShifts();
      var allOvertime = _SheetsService.getAllOvertime();

      var empMap = {};
      allEmployees.forEach(function(e) { empMap[e.ID] = e.Name; });
      var siteMap = {};
      allSites.forEach(function(s) { siteMap[s.ID] = s.Name; });

      var archivedEmployees = allEmployees
        .filter(function(e) { return e.Status === 'Archived'; })
        .map(function(e) {
          var empShifts = allShifts.filter(function(s) { return s['Employee ID'] === e.ID && s.Status !== 'Voided'; });
          var totalHours = empShifts.reduce(function(sum, s) {
            return sum + parseFloat(s['Regular Hours'] || 0) + parseFloat(s['Overtime Hours'] || 0);
          }, 0);
          return {
            id: e.ID,
            name: e.Name,
            phone: e.Phone || '',
            role: e.Role || 'Labourer',
            siteId: e['Site ID'] || '',
            siteName: siteMap[e['Site ID']] || e['Site ID'] || 'Unassigned',
            status: e.Status,
            archivedAt: e['Archived At'] || '',
            archivedBy: e['Archived By'] || '',
            archiveReason: e['Archive Reason'] || '',
            historicalShiftsCount: empShifts.length,
            historicalTotalHours: Math.round(totalHours * 100) / 100
          };
        });

      var archivedJobSites = allSites
        .filter(function(s) { return s.Status === 'Archived'; })
        .map(function(s) {
          var siteShifts = allShifts.filter(function(shift) { return String(shift['Site ID']) === s.ID && shift.Status !== 'Voided'; });
          return {
            id: s.ID,
            name: s.Name,
            address: s.Address || '',
            lat: parseFloat(s.Latitude),
            lon: parseFloat(s.Longitude),
            geofenceRadius: parseFloat(s['Geofence Radius'] || 100),
            status: s.Status,
            archivedAt: s['Archived At'] || '',
            archivedBy: s['Archived By'] || '',
            archiveReason: s['Archive Reason'] || '',
            historicalShiftsCount: siteShifts.length
          };
        });

      var voidedShifts = allShifts
        .filter(function(s) { return s.Status === 'Voided'; })
        .map(function(s) {
          return {
            id: s.ID,
            shiftId: s.ID,
            employeeId: s['Employee ID'],
            employeeName: empMap[s['Employee ID']] || s['Employee ID'],
            siteId: s['Site ID'],
            siteName: siteMap[s['Site ID']] || s['Site ID'],
            startTime: s['Start Time'],
            endTime: s['End Time'] || null,
            regularHours: parseFloat(s['Regular Hours'] || 0),
            overtimeHours: parseFloat(s['Overtime Hours'] || 0),
            status: s.Status,
            voidReason: s['Void Reason'] || '',
            voidedAt: s['Voided At'] || '',
            voidedBy: s['Voided By'] || ''
          };
        });

      var voidedOvertime = allOvertime
        .filter(function(o) {
          var st = (o['Approval Status'] || o.ApprovalStatus);
          return st === 'Cancelled' || st === 'Voided';
        })
        .map(function(o) {
          return {
            id: o.ID,
            shiftId: o['Shift ID'],
            employeeId: o['Employee ID'],
            employeeName: empMap[o['Employee ID']] || o['Employee ID'],
            date: o.Date,
            overtimeHours: parseFloat(o['Overtime Hours'] || 0),
            status: o['Approval Status'] || o.ApprovalStatus,
            voidReason: o['Void Reason'] || '',
            voidedAt: o['Voided At'] || '',
            voidedBy: o['Voided By'] || ''
          };
        });

      // Duplicate detection across active workforce for safe administrative resolution
      var duplicates = [];
      var activeEmps = allEmployees.filter(function(e) { return e.Status !== 'Archived'; });
      var nameCount = {};
      activeEmps.forEach(function(e) {
        var cleanName = (e.Name || '').trim().toLowerCase();
        if (cleanName) {
          nameCount[cleanName] = (nameCount[cleanName] || []).concat(e);
        }
      });

      var seenDupIds = {};
      Object.keys(nameCount).forEach(function(nameKey) {
        var list = nameCount[nameKey];
        if (list.length > 1) {
          list.forEach(function(emp) {
            if (!seenDupIds[emp.ID]) {
              seenDupIds[emp.ID] = true;
              duplicates.push({
                type: 'Employee Name Collision',
                recordType: 'Employee',
                id: emp.ID,
                name: emp.Name,
                phone: emp.Phone,
                status: emp.Status,
                siteId: emp['Site ID'],
                relatedCount: list.length,
                relatedRecords: list.map(function(r) {
                  return { id: r.ID, name: r.Name, phone: r.Phone, siteId: r['Site ID'], status: r.Status };
                })
              });
            }
          });
        }
      });

      return {
        success: true,
        archivedEmployees: archivedEmployees,
        archivedJobSites: archivedJobSites,
        voidedShifts: voidedShifts,
        voidedOvertime: voidedOvertime,
        duplicates: duplicates,
        counts: {
          archivedEmployees: archivedEmployees.length,
          archivedJobSites: archivedJobSites.length,
          voidedShifts: voidedShifts.length,
          voidedOvertime: voidedOvertime.length,
          duplicates: duplicates.length
        }
      };
    } catch (error) {
      return { success: false, message: 'Failed to retrieve archived records: ' + (error.message || error) };
    }
  };

  return new AdminServiceClass();
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = AdminService;
}