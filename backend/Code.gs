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

// Initialize the app
function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('Labour Attendance System');
}

function doPost(e) {
  try {
    const action = e.parameter.action;
    
    // Route actions to appropriate services
    switch (action) {
      case 'login':
        return AuthService.login(e);
      case 'getEmployeeData':
        return AuthService.getEmployeeData(e);
      case 'startShift':
        return ShiftService.startShift(e);
      case 'endShift':
        return ShiftService.endShift(e);
      case 'getJobSites':
        return AdminService.getJobSites(e);
      case 'getEmployees':
        return AdminService.getEmployees(e);
      case 'getAttendance':
        return AdminService.getAttendance(e);
      case 'approveOvertime':
        return OvertimeService.approveOvertime(e);
      case 'createJobSite':
        return AdminService.createJobSite(e);
      case 'createEmployee':
        return AdminService.createEmployee(e);
      case 'auditLog':
        return AdminService.auditLog(e);
      default:
        return {
          success: false,
          message: 'Invalid action: ' + action
        };
    }
  } catch (error) {
    console.error('Error in doPost:', error);
    return {
      success: false,
      message: 'Internal server error: ' + error.message
    };
  }
}

// Initialize the spreadsheet
function onOpen() {
  init();
}

// Initialize function
function init() {
  try {
    Logger.log('Initializing Labour Attendance System');
    SheetsService.initializeSheets();
    Logger.log('Labour Attendance System initialized successfully');
  } catch (error) {
    Logger.error('Initialization failed: ' + error);
  }
}

// Custom function for Excel-like formulas in Google Sheets
function getEmployeeName(employeeId) {
  const employee = SheetsService.getEmployeeById(employeeId);
  return employee ? employee.name : 'Unknown';
}

function getSiteName(siteId) {
  const site = SheetsService.getJobSiteById(siteId);
  return site ? site.name : 'Unknown';
}