const CONFIG = require('./Config');
const SHEETS = CONFIG.SHEETS;

/**
 * Google Sheets Service
 * Handles all interactions with Google Sheets database
 */
class SheetsService {
  /**
   * Get the active spreadsheet
   * @returns {GoogleAppsScript.Spreadsheet.Spreadsheet}
   */
  getSpreadsheet() {
    return SpreadsheetApp.getActiveSpreadsheet();
  }

  /**
   * Get a sheet by name, create if it doesn't exist
   * @param {string} sheetName
   * @returns {GoogleAppsScript.Spreadsheet.Sheet}
   */
  getOrCreateSheet(sheetName) {
    const ss = this.getSpreadsheet();
    let sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
    }
    return sheet;
  }

  /**
   * Initialize all required sheets with headers
   */
  initializeSheets() {
    const ss = this.getSpreadsheet();

    // Employees sheet
    const employeesSheet = this.getOrCreateSheet(SHEETS.EMPLOYEES);
    this.ensureHeaders(employeesSheet, [
      'ID', 'Name', 'Phone', 'Role', 'Site ID', 'PIN Hash', 'Status', 'Created At', 'Last Accessed'
    ]);

    // Job Sites sheet
    const jobSitesSheet = this.getOrCreateSheet(SHEETS.JOB_SITES);
    this.ensureHeaders(jobSitesSheet, [
      'ID', 'Name', 'Address', 'Latitude', 'Longitude', 'Geofence Radius', 'Status', 'Created At'
    ]);

    // Shifts sheet
    const shiftsSheet = this.getOrCreateSheet(SHEETS.SHIFTS);
    this.ensureHeaders(shiftsSheet, [
      'ID', 'Employee ID', 'Site ID', 'Start Time', 'End Time',
      'Start Latitude', 'Start Longitude', 'Start Accuracy',
      'End Latitude', 'End Longitude', 'End Accuracy',
      'Break Minutes', 'Regular Hours', 'Overtime Hours', 'Status', 'Created At'
    ]);

    // Overtime sheet
    const overtimeSheet = this.getOrCreateSheet(SHEETS.OVERTIME);
    this.ensureHeaders(overtimeSheet, [
      'ID', 'Shift ID', 'Employee ID', 'Date', 'Overtime Hours',
      'Approval Status', 'Approved By', 'Approved At', 'Created At'
    ]);

    // Settings sheet
    const settingsSheet = this.getOrCreateSheet(SHEETS.SETTINGS);
    this.ensureHeaders(settingsSheet, [
      'Key', 'Value', 'Description', 'Updated At'
    ]);
    this.initializeDefaultSettings(settingsSheet);

    // Audit Logs sheet
    const auditLogsSheet = this.getOrCreateSheet(SHEETS.AUDIT_LOGS);
    this.ensureHeaders(auditLogsSheet, [
      'ID', 'Employee ID', 'Action', 'Outcome', 'Timestamp', 'Performed By', 'Details'
    ]);

    Logger.log('All sheets initialized successfully');
  }

  /**
   * Ensure sheet has required headers
   * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
   * @param {string[]} headers
   */
  ensureHeaders(sheet, headers) {
    const range = sheet.getRange(1, 1, 1, headers.length);
    const existingHeaders = range.getValues()[0];
    
    const needsUpdate = headers.some((h, i) => existingHeaders[i] !== h);
    if (needsUpdate || existingHeaders.every(h => h === '')) {
      range.setValues([headers]);
      range.setFontWeight('bold');
      range.setBackground('#4285f4');
      range.setFontColor('#ffffff');
    }
  }

  /**
   * Initialize default settings
   * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
   */
  initializeDefaultSettings(sheet) {
    const defaults = [
      ['companyName', 'UAE Labour Management', 'Company name for reports', new Date().toISOString()],
      ['timezone', 'Asia/Dubai', 'IANA timezone identifier', new Date().toISOString()],
      ['regularHours', '8', 'Regular working hours per day', new Date().toISOString()],
      ['breakDuration', '60', 'Break duration in minutes', new Date().toISOString()],
      ['gpsAccuracyThreshold', '20', 'Target GPS accuracy in meters', new Date().toISOString()],
      ['gpsMaxAccuracyMismatch', '30', 'Maximum acceptable GPS accuracy in meters', new Date().toISOString()],
      ['defaultGeofenceRadius', '100', 'Default geofence radius in meters', new Date().toISOString()],
      ['gpsRetryAttempts', '3', 'Number of GPS retry attempts', new Date().toISOString()],
    ];

    const existingData = sheet.getDataRange().getValues();
    if (existingData.length <= 1) {
      sheet.getRange(2, 1, defaults.length, 4).setValues(defaults);
    }
  }

  /**
   * Get all rows from a sheet as objects
   * @param {string} sheetName
   * @returns {Object[]}
   */
  getAllRows(sheetName) {
    const sheet = this.getOrCreateSheet(sheetName);
    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) return [];
    
    const headers = data[0];
    return data.slice(1).map(row => {
      const obj = {};
      headers.forEach((header, i) => {
        obj[header] = row[i];
      });
      return obj;
    });
  }

  /**
   * Find a row by ID
   * @param {string} sheetName
   * @param {string} id
   * @returns {Object|null}
   */
  findById(sheetName, id) {
    const rows = this.getAllRows(sheetName);
    return rows.find(row => row.ID === id) || null;
  }

  /**
   * Append a new row
   * @param {string} sheetName
   * @param {Object} data
   * @returns {Object} The created row with ID
   */
  appendRow(sheetName, data) {
    const sheet = this.getOrCreateSheet(sheetName);
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const rowData = headers.map(h => data[h] ?? '');
    const newRow = sheet.getLastRow() + 1;
    sheet.getRange(newRow, 1, 1, rowData.length).setValues([rowData]);
    return this.findById(sheetName, data.ID);
  }

  /**
   * Update a row by ID
   * @param {string} sheetName
   * @param {string} id
   * @param {Object} data
   * @returns {boolean}
   */
  updateRow(sheetName, id, data) {
    const sheet = this.getOrCreateSheet(sheetName);
    const dataRange = sheet.getDataRange();
    const values = dataRange.getValues();
    const headers = values[0];
    
    for (let i = 1; i < values.length; i++) {
      if (values[i][0] === id) {
        const rowData = headers.map(h => data[h] ?? values[i][headers.indexOf(h)]);
        sheet.getRange(i + 1, 1, 1, rowData.length).setValues([rowData]);
        return true;
      }
    }
    return false;
  }

  /**
   * Get employee by ID
   * @param {string} employeeId
   * @returns {Object|null}
   */
  getEmployeeById(employeeId) {
    return this.findById(SHEETS.EMPLOYEES, employeeId);
  }

  /**
   * Get job site by ID
   * @param {string} siteId
   * @returns {Object|null}
   */
  getJobSiteById(siteId) {
    return this.findById(SHEETS.JOB_SITES, siteId);
  }

  /**
   * Get all employees
   * @returns {Object[]}
   */
  getAllEmployees() {
    return this.getAllRows(SHEETS.EMPLOYEES);
  }

  /**
   * Get all job sites
   * @returns {Object[]}
   */
  getAllJobSites() {
    return this.getAllRows(SHEETS.JOB_SITES);
  }

  /**
   * Get all shifts
   * @returns {Object[]}
   */
  getAllShifts() {
    return this.getAllRows(SHEETS.SHIFTS);
  }

  /**
   * Get all overtime records
   * @returns {Object[]}
   */
  getAllOvertime() {
    return this.getAllRows(SHEETS.OVERTIME);
  }

  /**
   * Get setting value
   * @param {string} key
   * @returns {string|null}
   */
  getSetting(key) {
    const settings = this.getAllRows(SHEETS.SETTINGS);
    const setting = settings.find(s => s.Key === key);
    return setting ? setting.Value : null;
  }

  /**
   * Set setting value
   * @param {string} key
   * @param {string} value
   */
  setSetting(key, value) {
    const sheet = this.getOrCreateSheet(SHEETS.SETTINGS);
    const dataRange = sheet.getDataRange();
    const values = dataRange.getValues();
    
    for (let i = 1; i < values.length; i++) {
      if (values[i][0] === key) {
        sheet.getRange(i + 1, 2).setValue(value);
        sheet.getRange(i + 1, 4).setValue(new Date().toISOString());
        return;
      }
    }
    
    // Not found, append new
    const newRow = sheet.getLastRow() + 1;
    sheet.getRange(newRow, 1, 1, 4).setValues([[key, value, '', new Date().toISOString()]]);
  }

  /**
   * Generate unique ID
   * @param {string} prefix
   * @returns {string}
   */
  generateId(prefix) {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substr(2, 5);
    return `${prefix}${timestamp}${random}`.toUpperCase();
  }

  /**
   * Generate Employee ID
   * @returns {string}
   */
  generateEmployeeId() {
    return this.generateId('EMP');
  }

  /**
   * Generate Site ID
   * @returns {string}
   */
  generateSiteId() {
    return this.generateId('SITE');
  }

  /**
   * Generate Shift ID
   * @returns {string}
   */
  generateShiftId() {
    return this.generateId('SHIFT');
  }

  /**
   * Generate Overtime ID
   * @returns {string}
   */
  generateOvertimeId() {
    return this.generateId('OT');
  }

  /**
   * Generate Audit Log ID
   * @returns {string}
   */
  generateAuditId() {
    return this.generateId('AL');
  }
}

module.exports = new SheetsService();