/**
 * Overtime Tracker — Google Apps Script Main Web App Entry Point
 * Handles doGet and doPost with authentication gatekeeping and role-based authorization
 * Dual compatible with Google Apps Script runtime and Node.js
 */

var _ConfigModule = (typeof CONFIG !== 'undefined') ? { CONFIG: CONFIG } : 
  (typeof require !== 'undefined' ? require('./lib/Config') : { CONFIG: {} });
var _CONFIG = _ConfigModule.CONFIG;

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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    doGet: doGet,
    doPost: doPost,
    init: init,
    jsonResponse: jsonResponse
  };
}