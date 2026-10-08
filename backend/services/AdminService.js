const CONFIG = require('../lib/Config');
const SheetsService = require('./SheetsService');

/**
 * Admin Service
 * Handles administrative operations: employees, job sites, reports
 */
class AdminService {
  constructor() {
    this.sheets = SheetsService;
  }

  /**
   * Get all job sites
   * @param {Object} params - Request parameters
   * @returns {Object}
   */
  getJobSites(params) {
    try {
      const sites = this.sheets.getAllJobSites();
      return {
        success: true,
        jobSites: sites.map(s => ({
          id: s.ID,
          name: s.Name,
          address: s.Address,
          lat: parseFloat(s.Latitude),
          lon: parseFloat(s.Longitude),
          geofenceRadius: parseFloat(s['Geofence Radius'] || s.GeofenceRadius || CONFIG.DEFAULT_GEOFENCE_RADIUS),
          status: s.Status
        }))
      };
    } catch (error) {
      Logger.error('Get job sites error: ' + error.message);
      return this.errorResponse('Failed to get job sites');
    }
  }

  /**
   * Get all employees
   * @param {Object} params - Request parameters
   * @returns {Object}
   */
  getEmployees(params) {
    try {
      const employees = this.sheets.getAllEmployees();
      return {
        success: true,
        employees: employees.map(e => ({
          id: e.ID,
          name: e.Name,
          phone: e.Phone,
          role: e.Role,
          siteId: e['Site ID'] || e.SiteID,
          status: e.Status,
          createdAt: e['Created At']
        }))
      };
    } catch (error) {
      Logger.error('Get employees error: ' + error.message);
      return this.errorResponse('Failed to get employees');
    }
  }

  /**
   * Get attendance data
   * @param {Object} params - Request parameters
   * @returns {Object}
   */
  getAttendance(params) {
    try {
      const { date, employeeId, siteId } = params;
      const shifts = this.sheets.getAllShifts();
      
      let filtered = shifts;
      
      if (date) {
        const targetDate = new Date(date).toISOString().split('T')[0];
        filtered = filtered.filter(s => {
          const shiftDate = new Date(s['Start Time']).toISOString().split('T')[0];
          return shiftDate === targetDate;
        });
      }
      
      if (employeeId) {
        filtered = filtered.filter(s => s['Employee ID'] === employeeId);
      }
      
      if (siteId) {
        filtered = filtered.filter(s => s['Site ID'] === siteId);
      }

      const attendance = filtered.map(s => {
        const employee = this.sheets.getEmployeeById(s['Employee ID']);
        const site = this.sheets.getJobSiteById(s['Site ID']);
        return {
          shiftId: s.ID,
          employeeId: s['Employee ID'],
          employeeName: employee ? employee.Name : 'Unknown',
          siteId: s['Site ID'],
          siteName: site ? site.Name : 'Unknown',
          startTime: s['Start Time'],
          endTime: s['End Time'],
          startLat: parseFloat(s['Start Latitude']),
          startLon: parseFloat(s['Start Longitude']),
          startAccuracy: parseFloat(s['Start Accuracy']),
          endLat: parseFloat(s['End Latitude']),
          endLon: parseFloat(s['End Longitude']),
          endAccuracy: parseFloat(s['End Accuracy']),
          breakMinutes: parseFloat(s['Break Minutes']),
          regularHours: parseFloat(s['Regular Hours']),
          overtimeHours: parseFloat(s['Overtime Hours']),
          status: s.Status
        };
      });

      return {
        success: true,
        attendance
      };
    } catch (error) {
      Logger.error('Get attendance error: ' + error.message);
      return this.errorResponse('Failed to get attendance');
    }
  }

  /**
   * Create a new job site
   * @param {Object} params - Request parameters
   * @returns {Object}
   */
  createJobSite(params) {
    try {
      const { name, address, lat, lon, geofenceRadius } = params;
      
      if (!name || !address || lat === undefined || lon === undefined) {
        return this.errorResponse('Name, address, latitude, and longitude are required');
      }

      const siteId = this.sheets.generateSiteId();
      const siteData = {
        ID: siteId,
        Name: name,
        Address: address,
        Latitude: lat,
        Longitude: lon,
        'Geofence Radius': geofenceRadius || CONFIG.DEFAULT_GEOFENCE_RADIUS,
        Status: 'Active',
        'Created At': new Date().toISOString()
      };

      this.sheets.appendRow(CONFIG.SHEETS.JOB_SITES, siteData);
      this.logAudit('system', 'Create Job Site', 'success', `Created site ${siteId}: ${name}`);

      return {
        success: true,
        siteId,
        message: 'Job site created successfully'
      };
    } catch (error) {
      Logger.error('Create job site error: ' + error.message);
      return this.errorResponse('Failed to create job site');
    }
  }

  /**
   * Create a new employee
   * @param {Object} params - Request parameters
   * @returns {Object}
   */
  createEmployee(params) {
    try {
      const { name, phone, role, siteId, pin } = params;
      
      if (!name || !phone || !role || !siteId || !pin) {
        return this.errorResponse('Name, phone, role, site ID, and PIN are required');
      }

      const site = this.sheets.getJobSiteById(siteId);
      if (!site) {
        return this.errorResponse('Invalid site ID');
      }

      const employeeId = this.sheets.generateEmployeeId();
      const authService = require('./AuthService');
      const pinHash = authService.hashPin(pin);

      const employeeData = {
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

      this.sheets.appendRow(CONFIG.SHEETS.EMPLOYEES, employeeData);
      this.logAudit('system', 'Create Employee', 'success', `Created employee ${employeeId}: ${name}`);

      return {
        success: true,
        employeeId,
        pinHash,
        message: 'Employee created successfully'
      };
    } catch (error) {
      Logger.error('Create employee error: ' + error.message);
      return this.errorResponse('Failed to create employee');
    }
  }

  /**
   * Deactivate an employee
   * @param {Object} params - Request parameters
   * @returns {Object}
   */
  deactivateEmployee(params) {
    try {
      const { employeeId } = params;
      
      if (!employeeId) {
        return this.errorResponse('Employee ID required');
      }

      const updated = this.sheets.updateRow(CONFIG.SHEETS.EMPLOYEES, employeeId, {
        Status: 'Inactive'
      });

      if (!updated) {
        return this.errorResponse('Employee not found');
      }

      this.logAudit('system', 'Deactivate Employee', 'success', `Deactivated employee ${employeeId}`);

      return {
        success: true,
        message: 'Employee deactivated'
      };
    } catch (error) {
      Logger.error('Deactivate employee error: ' + error.message);
      return this.errorResponse('Failed to deactivate employee');
    }
  }

  /**
   * Get audit logs
   * @param {Object} params - Request parameters
   * @returns {Object}
   */
  getAuditLogs(params) {
    try {
      const { employeeId, limit = 100 } = params;
      let logs = this.sheets.getAllRows(CONFIG.SHEETS.AUDIT_LOGS);
      
      if (employeeId) {
        logs = logs.filter(l => l['Employee ID'] === employeeId);
      }
      
      logs.sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp));
      logs = logs.slice(0, limit);

      return {
        success: true,
        auditLogs: logs
      };
    } catch (error) {
      Logger.error('Get audit logs error: ' + error.message);
      return this.errorResponse('Failed to get audit logs');
    }
  }

  /**
   * Generate daily report
   * @param {Object} params - Request parameters
   * @returns {Object}
   */
  generateDailyReport(params) {
    try {
      const { date } = params;
      const targetDate = date ? new Date(date) : new Date();
      const dateStr = targetDate.toISOString().split('T')[0];

      const shifts = this.sheets.getAllShifts().filter(s => {
        const shiftDate = new Date(s['Start Time']).toISOString().split('T')[0];
        return shiftDate === dateStr;
      });

      const employees = this.sheets.getAllEmployees();
      const sites = this.sheets.getAllJobSites();

      const report = {
        date: dateStr,
        totalEmployees: employees.filter(e => e.Status === 'Active').length,
        totalShifts: shifts.length,
        completedShifts: shifts.filter(s => s.Status === 'Completed').length,
        activeShifts: shifts.filter(s => s.Status === 'Active').length,
        totalRegularHours: shifts.reduce((sum, s) => sum + parseFloat(s['Regular Hours'] || 0), 0),
        totalOvertimeHours: shifts.reduce((sum, s) => sum + parseFloat(s['Overtime Hours'] || 0), 0),
        bySite: {},
        byEmployee: {}
      };

      shifts.forEach(shift => {
        const siteId = shift['Site ID'];
        const empId = shift['Employee ID'];
        
        if (!report.bySite[siteId]) {
          const site = sites.find(s => s.ID === siteId);
          report.bySite[siteId] = {
            siteName: site ? site.Name : 'Unknown',
            shifts: 0,
            regularHours: 0,
            overtimeHours: 0
          };
        }
        report.bySite[siteId].shifts++;
        report.bySite[siteId].regularHours += parseFloat(shift['Regular Hours'] || 0);
        report.bySite[siteId].overtimeHours += parseFloat(shift['Overtime Hours'] || 0);

        if (!report.byEmployee[empId]) {
          const emp = employees.find(e => e.ID === empId);
          report.byEmployee[empId] = {
            employeeName: emp ? emp.Name : 'Unknown',
            shifts: 0,
            regularHours: 0,
            overtimeHours: 0
          };
        }
        report.byEmployee[empId].shifts++;
        report.byEmployee[empId].regularHours += parseFloat(shift['Regular Hours'] || 0);
        report.byEmployee[empId].overtimeHours += parseFloat(shift['Overtime Hours'] || 0);
      });

      return {
        success: true,
        report
      };
    } catch (error) {
      Logger.error('Generate daily report error: ' + error.message);
      return this.errorResponse('Failed to generate daily report');
    }
  }

  /**
   * Generate monthly report
   * @param {Object} params - Request parameters
   * @returns {Object}
   */
  generateMonthlyReport(params) {
    try {
      const { year, month } = params;
      const targetYear = year || new Date().getFullYear();
      const targetMonth = month !== undefined ? month : new Date().getMonth() + 1;

      const shifts = this.sheets.getAllShifts().filter(s => {
        const shiftDate = new Date(s['Start Time']);
        return shiftDate.getFullYear() === targetYear && shiftDate.getMonth() + 1 === targetMonth;
      });

      const employees = this.sheets.getAllEmployees();
      const sites = this.sheets.getAllJobSites();

      const report = {
        year: targetYear,
        month: targetMonth,
        totalEmployees: employees.filter(e => e.Status === 'Active').length,
        totalShifts: shifts.length,
        completedShifts: shifts.filter(s => s.Status === 'Completed').length,
        totalRegularHours: shifts.reduce((sum, s) => sum + parseFloat(s['Regular Hours'] || 0), 0),
        totalOvertimeHours: shifts.reduce((sum, s) => sum + parseFloat(s['Overtime Hours'] || 0), 0),
        byEmployee: {}
      };

      shifts.forEach(shift => {
        const empId = shift['Employee ID'];
        if (!report.byEmployee[empId]) {
          const emp = employees.find(e => e.ID === empId);
          report.byEmployee[empId] = {
            employeeName: emp ? emp.Name : 'Unknown',
            shifts: 0,
            regularHours: 0,
            overtimeHours: 0,
            daysWorked: new Set()
          };
        }
        report.byEmployee[empId].shifts++;
        report.byEmployee[empId].regularHours += parseFloat(shift['Regular Hours'] || 0);
        report.byEmployee[empId].overtimeHours += parseFloat(shift['Overtime Hours'] || 0);
        report.byEmployee[empId].daysWorked.add(new Date(shift['Start Time']).getDate());
      });

      // Convert daysWorked Set to count
      Object.keys(report.byEmployee).forEach(empId => {
        report.byEmployee[empId].daysWorked = report.byEmployee[empId].daysWorked.size;
      });

      return {
        success: true,
        report
      };
    } catch (error) {
      Logger.error('Generate monthly report error: ' + error.message);
      return this.errorResponse('Failed to generate monthly report');
    }
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

module.exports = new AdminService();