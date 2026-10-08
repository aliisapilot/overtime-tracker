// Google Apps Script Main Code
// This is the primary entry point for the web app

// Import required libraries
const CONFIG = require('./lib/Config');
const SheetsService = require('./services/SheetsService');
const AuthService = require('./services/AuthService');
const LocationService = require('./services/LocationService');
const ShiftService = require('./services/ShiftService');
const OvertimeService = require('./services/OvertimeService');
const AdminService = require('./services/AdminService');

/**
 * Handle GET requests - returns API info
 */
function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({
    name: 'Labour Attendance & Overtime API',
    version: '1.0.0',
    status: 'active',
    endpoints: {
      login: 'POST {action: "login", employeeId, pin}',
      getEmployeeData: 'GET/POST {action: "getEmployeeData", employeeId}',
      startShift: 'POST {action: "startShift", employeeId, lat, lon, accuracy}',
      endShift: 'POST {action: "endShift", employeeId, lat, lon, accuracy}',
      getJobSites: 'GET/POST {action: "getJobSites"}',
      getEmployees: 'GET/POST {action: "getEmployees"}',
      getAttendance: 'GET/POST {action: "getAttendance", date?, employeeId?, siteId?}',
      approveOvertime: 'POST {action: "approveOvertime", overtimeId, status, approvedBy}',
      createJobSite: 'POST {action: "createJobSite", name, address, lat, lon, geofenceRadius?}',
      createEmployee: 'POST {action: "createEmployee", name, phone, role, siteId, pin}',
      deactivateEmployee: 'POST {action: "deactivateEmployee", employeeId}',
      getAuditLogs: 'GET/POST {action: "getAuditLogs", employeeId?, limit?}',
      generateDailyReport: 'GET/POST {action: "generateDailyReport", date?}',
      generateMonthlyReport: 'GET/POST {action: "generateMonthlyReport", year?, month?}'
    }
  })).setMimeType(ContentService.MimeType.JSON);
}

/**
 * Handle POST requests - routes to appropriate services
 */
function doPost(e) {
  try {
    let params = {};
    
    if (e.postData && e.postData.contents) {
      params = JSON.parse(e.postData.contents);
    } else if (e.parameter) {
      params = e.parameter;
    }
    
    const action = params.action;
    
    if (!action) {
      return jsonResponse({
        success: false,
        message: 'Action parameter is required'
      });
    }
    
    // Route actions to appropriate services
    switch (action) {
      case 'login':
        return jsonResponse(AuthService.login(params));
      case 'getEmployeeData':
        return jsonResponse(AuthService.getEmployeeData(params));
      case 'startShift':
        return jsonResponse(ShiftService.startShift(params));
      case 'endShift':
        return jsonResponse(ShiftService.endShift(params));
      case 'getJobSites':
        return jsonResponse(AdminService.getJobSites(params));
      case 'getEmployees':
        return jsonResponse(AdminService.getEmployees(params));
      case 'getAttendance':
        return jsonResponse(AdminService.getAttendance(params));
      case 'approveOvertime':
        return jsonResponse(OvertimeService.approveOvertime(params));
      case 'createJobSite':
        return jsonResponse(AdminService.createJobSite(params));
      case 'createEmployee':
        return jsonResponse(AdminService.createEmployee(params));
      case 'deactivateEmployee':
        return jsonResponse(AdminService.deactivateEmployee(params));
      case 'getAuditLogs':
        return jsonResponse(AdminService.getAuditLogs(params));
      case 'generateDailyReport':
        return jsonResponse(AdminService.generateDailyReport(params));
      case 'generateMonthlyReport':
        return jsonResponse(AdminService.generateMonthlyReport(params));
      default:
        return jsonResponse({
          success: false,
          message: 'Invalid action: ' + action
        });
    }
  } catch (error) {
    logError('Error in doPost:', error);
    return jsonResponse({
      success: false,
      message: 'Internal server error: ' + error.message
    });
  }
}

/**
 * Helper to return JSON response
 */
function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Log error with timestamp
 */
function logError(message, error) {
  Logger.log('[ERROR] ' + message + (error ? ' - ' + error.message : '') + (error && error.stack ? '\n' + error.stack : ''));
}

/**
 * Initialize the spreadsheet - run once after deployment
 */
function init() {
  try {
    Logger.log('Initializing Labour Attendance System');
    SheetsService.initializeSheets();
    Logger.log('Labour Attendance System initialized successfully');
  } catch (error) {
    logError('Initialization failed', error);
  }
}

/**
 * Custom function for Excel-like formulas in Google Sheets
 */
function getEmployeeName(employeeId) {
  const employee = SheetsService.getEmployeeById(employeeId);
  return employee ? employee.Name : 'Unknown';
}

function getSiteName(siteId) {
  const site = SheetsService.getJobSiteById(siteId);
  return site ? site.Name : 'Unknown';
}