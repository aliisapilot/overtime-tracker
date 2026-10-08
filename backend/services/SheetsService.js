/**
 * Google Sheets Service
 * Handles all interactions with Google Sheets database
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

var SheetsService = (function() {
  function SheetsServiceClass() {
    this._mockData = null; // Used for local Node tests
  }

  /**
   * Set mock data for local automated testing
   */
  SheetsServiceClass.prototype.setMockData = function(data) {
    this._mockData = data;
  };

  /**
   * Get the active spreadsheet
   * @returns {GoogleAppsScript.Spreadsheet.Spreadsheet}
   */
  SheetsServiceClass.prototype.getSpreadsheet = function() {
    if (typeof SpreadsheetApp !== 'undefined') {
      return SpreadsheetApp.getActiveSpreadsheet();
    }
    return null;
  };

  /**
   * Get a sheet by name, create if it doesn't exist
   * @param {string} sheetName
   * @returns {GoogleAppsScript.Spreadsheet.Sheet}
   */
  SheetsServiceClass.prototype.getOrCreateSheet = function(sheetName) {
    var ss = this.getSpreadsheet();
    if (!ss) return null;
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
    }
    return sheet;
  };

  /**
   * Initialize all required sheets with headers and default records
   */
  SheetsServiceClass.prototype.initializeSheets = function() {
    var ss = this.getSpreadsheet();
    if (!ss) {
      if (typeof Logger !== 'undefined') {
        Logger.log('SpreadsheetApp not available - mock or local environment');
      }
      return { success: true, message: 'Local/mock environment initialization' };
    }

    // 1. Employees sheet
    var employeesSheet = this.getOrCreateSheet(_SHEETS.EMPLOYEES);
    this.ensureHeaders(employeesSheet, [
      'ID', 'Name', 'Phone', 'Role', 'Site ID', 'PIN Hash', 'Status', 'Created At', 'Last Accessed'
    ]);

    // 2. Job Sites sheet (Headers only - NO sample production sites)
    var jobSitesSheet = this.getOrCreateSheet(_SHEETS.JOB_SITES);
    this.ensureHeaders(jobSitesSheet, [
      'ID', 'Name', 'Address', 'Latitude', 'Longitude', 'Geofence Radius', 'Status', 'Created At'
    ]);

    // 3. Shifts sheet
    var shiftsSheet = this.getOrCreateSheet(_SHEETS.SHIFTS);
    this.ensureHeaders(shiftsSheet, [
      'ID', 'Employee ID', 'Site ID', 'Start Time', 'End Time',
      'Start Latitude', 'Start Longitude', 'Start Accuracy',
      'End Latitude', 'End Longitude', 'End Accuracy',
      'Break Minutes', 'Regular Hours', 'Overtime Hours', 'Status', 'Created At'
    ]);

    // 4. Overtime sheet
    var overtimeSheet = this.getOrCreateSheet(_SHEETS.OVERTIME);
    this.ensureHeaders(overtimeSheet, [
      'ID', 'Shift ID', 'Employee ID', 'Date', 'Overtime Hours',
      'Approval Status', 'Approved By', 'Approved At', 'Created At'
    ]);

    // 5. Settings sheet
    var settingsSheet = this.getOrCreateSheet(_SHEETS.SETTINGS);
    this.ensureHeaders(settingsSheet, [
      'Key', 'Value', 'Description', 'Updated At'
    ]);
    this.initializeDefaultSettings(settingsSheet);

    // 6. Audit Logs sheet
    var auditLogsSheet = this.getOrCreateSheet(_SHEETS.AUDIT_LOGS);
    this.ensureHeaders(auditLogsSheet, [
      'ID', 'Employee ID', 'Action', 'Outcome', 'Timestamp', 'Performed By', 'Details'
    ]);

    // Seed default admin employee if Employees sheet is empty (with secure random PIN)
    var adminInitResult = this.seedDefaultAdmin(employeesSheet);

    // Clean up empty default "Sheet1" if present and other sheets exist
    try {
      var defaultSheet = ss.getSheetByName('Sheet1');
      if (defaultSheet && ss.getSheets().length > 1 && defaultSheet.getLastRow() === 0) {
        ss.deleteSheet(defaultSheet);
      }
    } catch (e) {
      // Ignore sheet deletion error
    }

    if (typeof Logger !== 'undefined') {
      Logger.log('All sheets initialized successfully');
    }

    return { 
      success: true, 
      message: 'Spreadsheet initialized successfully',
      adminNote: adminInitResult ? adminInitResult.message : null
    };
  };

  /**
   * Ensure sheet has required headers without deleting data
   */
  SheetsServiceClass.prototype.ensureHeaders = function(sheet, headers) {
    if (!sheet) return;
    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();

    if (lastRow === 0 || lastCol === 0) {
      var range = sheet.getRange(1, 1, 1, headers.length);
      range.setValues([headers]);
      range.setFontWeight('bold');
      range.setBackground('#1e3a8a'); // Professional dark navy
      range.setFontColor('#ffffff');
      sheet.setFrozenRows(1);
      return;
    }

    var range = sheet.getRange(1, 1, 1, Math.max(lastCol, headers.length));
    var existingHeaders = range.getValues()[0];
    var isBlank = existingHeaders.every(function(h) { return h === ''; });

    if (isBlank) {
      var headerRange = sheet.getRange(1, 1, 1, headers.length);
      headerRange.setValues([headers]);
      headerRange.setFontWeight('bold');
      headerRange.setBackground('#1e3a8a');
      headerRange.setFontColor('#ffffff');
      sheet.setFrozenRows(1);
    }
  };

  /**
   * Initialize default settings if empty
   */
  SheetsServiceClass.prototype.initializeDefaultSettings = function(sheet) {
    if (!sheet) return;
    var defaults = [
      ['companyName', 'UAE Labour Management', 'Company name for reports', new Date().toISOString()],
      ['timezone', 'Asia/Dubai', 'IANA timezone identifier', new Date().toISOString()],
      ['regularHours', '8', 'Regular working hours per day', new Date().toISOString()],
      ['breakDuration', '60', 'Break duration in minutes', new Date().toISOString()],
      ['gpsAccuracyThreshold', '20', 'Target GPS accuracy in meters', new Date().toISOString()],
      ['gpsMaxAccuracyMismatch', '30', 'Maximum acceptable GPS accuracy in meters', new Date().toISOString()],
      ['defaultGeofenceRadius', '100', 'Default geofence radius in meters', new Date().toISOString()],
      ['gpsRetryAttempts', '3', 'Number of GPS retry attempts', new Date().toISOString()],
    ];

    if (sheet.getLastRow() <= 1) {
      sheet.getRange(2, 1, defaults.length, 4).setValues(defaults);
    }
  };

  /**
   * Seed Ateeb as default Admin using ADMIN_PIN configured in Script Properties
   * Completely avoids logging PINs or setup tokens to Execution Logs
   */
  SheetsServiceClass.prototype.seedDefaultAdmin = function(sheet) {
    if (!sheet && !this._mockData) return null;
    
    // Check if EMP000 already exists
    var existingAdmin = this.findById(_SHEETS.EMPLOYEES, 'EMP000');
    if (existingAdmin && existingAdmin.Status === 'Active') {
      return { created: false, message: 'Admin account EMP000 is already active.' };
    }

    var configuredPin = null;
    if (typeof PropertiesService !== 'undefined' && PropertiesService.getScriptProperties) {
      var props = PropertiesService.getScriptProperties();
      configuredPin = props.getProperty('ADMIN_PIN');
    } else if (this._mockAdminPin) {
      configuredPin = this._mockAdminPin;
    }

    if (!configuredPin) {
      if (typeof Logger !== 'undefined') {
        Logger.log('[SECURITY NOTICE] To activate Administrator account (EMP000), set Script Property "ADMIN_PIN" in Project Settings and run init().');
      }
      if (!existingAdmin) {
        var placeholder = {
          ID: 'EMP000',
          Name: 'Ateeb',
          Phone: '+971500000000',
          Role: _CONFIG.ADMIN_ROLE || 'Admin',
          'Site ID': '',
          'PIN Hash': 'PENDING_PIN_CONFIGURATION',
          Status: 'PendingSetup',
          'Created At': new Date().toISOString(),
          'Last Accessed': ''
        };
        this.appendRow(_SHEETS.EMPLOYEES, placeholder);
      }
      return { created: false, message: 'Admin account pending setup. Add Script Property ADMIN_PIN and re-run init().' };
    }

    // PIN is present in Script Properties: hash with standard PBKDF2 (25k iter, 32-char salt)
    var pinHash = _CryptoUtils.hashPin(configuredPin);

    if (existingAdmin) {
      this.updateRow(_SHEETS.EMPLOYEES, 'EMP000', {
        'PIN Hash': pinHash,
        Status: 'Active'
      });
    } else {
      var adminData = {
        ID: 'EMP000',
        Name: 'Ateeb',
        Phone: '+971500000000',
        Role: _CONFIG.ADMIN_ROLE || 'Admin',
        'Site ID': '',
        'PIN Hash': pinHash,
        Status: 'Active',
        'Created At': new Date().toISOString(),
        'Last Accessed': ''
      };
      this.appendRow(_SHEETS.EMPLOYEES, adminData);
    }

    // Immediately and securely delete plain text ADMIN_PIN property so it never persists
    if (typeof PropertiesService !== 'undefined' && PropertiesService.getScriptProperties) {
      PropertiesService.getScriptProperties().deleteProperty('ADMIN_PIN');
    }
    this._mockAdminPin = null;

    if (typeof Logger !== 'undefined') {
      Logger.log('[SECURITY] Administrator account (EMP000) successfully activated. The plain text ADMIN_PIN property has been securely deleted.');
    }

    return { created: true, message: 'Administrator account EMP000 successfully activated.' };
  };

  /**
   * Set mock admin PIN for automated tests
   */
  SheetsServiceClass.prototype.setMockAdminPin = function(pin) {
    this._mockAdminPin = pin;
  };

  /**
   * Get all rows from a sheet as plain objects
   * @param {string} sheetName
   * @returns {Object[]}
   */
  SheetsServiceClass.prototype.getAllRows = function(sheetName) {
    if (this._mockData && this._mockData[sheetName]) {
      return this._mockData[sheetName];
    }

    var sheet = this.getOrCreateSheet(sheetName);
    if (!sheet) return [];
    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) return [];

    var headers = data[0];
    return data.slice(1).map(function(row) {
      var obj = {};
      headers.forEach(function(header, i) {
        if (header) {
          obj[header] = row[i];
        }
      });
      return obj;
    });
  };

  /**
   * Find a row by ID
   * @param {string} sheetName
   * @param {string} id
   * @returns {Object|null}
   */
  SheetsServiceClass.prototype.findById = function(sheetName, id) {
    var rows = this.getAllRows(sheetName);
    return rows.find(function(row) { return String(row.ID) === String(id); }) || null;
  };

  /**
   * Append a new row
   * @param {string} sheetName
   * @param {Object} data
   * @returns {Object}
   */
  SheetsServiceClass.prototype.appendRow = function(sheetName, data) {
    if (this._mockData) {
      if (!this._mockData[sheetName]) this._mockData[sheetName] = [];
      this._mockData[sheetName].push(Object.assign({}, data));
      return data;
    }

    var sheet = this.getOrCreateSheet(sheetName);
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var rowData = headers.map(function(h) { return data[h] !== undefined ? data[h] : ''; });
    var newRow = sheet.getLastRow() + 1;
    sheet.getRange(newRow, 1, 1, rowData.length).setValues([rowData]);
    return this.findById(sheetName, data.ID);
  };

  /**
   * Update a row by ID
   * @param {string} sheetName
   * @param {string} id
   * @param {Object} data
   * @returns {boolean}
   */
  SheetsServiceClass.prototype.updateRow = function(sheetName, id, data) {
    if (this._mockData && this._mockData[sheetName]) {
      var index = this._mockData[sheetName].findIndex(function(r) { return String(r.ID) === String(id); });
      if (index !== -1) {
        Object.assign(this._mockData[sheetName][index], data);
        return true;
      }
      return false;
    }

    var sheet = this.getOrCreateSheet(sheetName);
    if (!sheet) return false;
    var dataRange = sheet.getDataRange();
    var values = dataRange.getValues();
    if (values.length <= 1) return false;
    var headers = values[0];

    for (var i = 1; i < values.length; i++) {
      if (String(values[i][0]) === String(id)) {
        var rowData = headers.map(function(h) {
          return data[h] !== undefined ? data[h] : values[i][headers.indexOf(h)];
        });
        sheet.getRange(i + 1, 1, 1, rowData.length).setValues([rowData]);
        return true;
      }
    }
    return false;
  };

  /**
   * Get employee by ID
   */
  SheetsServiceClass.prototype.getEmployeeById = function(employeeId) {
    return this.findById(_SHEETS.EMPLOYEES, employeeId);
  };

  /**
   * Get job site by ID
   */
  SheetsServiceClass.prototype.getJobSiteById = function(siteId) {
    return this.findById(_SHEETS.JOB_SITES, siteId);
  };

  /**
   * Get all employees
   */
  SheetsServiceClass.prototype.getAllEmployees = function() {
    return this.getAllRows(_SHEETS.EMPLOYEES);
  };

  /**
   * Get all job sites
   */
  SheetsServiceClass.prototype.getAllJobSites = function() {
    return this.getAllRows(_SHEETS.JOB_SITES);
  };

  /**
   * Get all shifts
   */
  SheetsServiceClass.prototype.getAllShifts = function() {
    return this.getAllRows(_SHEETS.SHIFTS);
  };

  /**
   * Get all overtime records
   */
  SheetsServiceClass.prototype.getAllOvertime = function() {
    return this.getAllRows(_SHEETS.OVERTIME);
  };

  /**
   * Get setting value
   */
  SheetsServiceClass.prototype.getSetting = function(key) {
    var settings = this.getAllRows(_SHEETS.SETTINGS);
    var setting = settings.find(function(s) { return s.Key === key; });
    return setting ? setting.Value : null;
  };

  /**
   * Set setting value
   */
  SheetsServiceClass.prototype.setSetting = function(key, value) {
    if (this._mockData && this._mockData[_SHEETS.SETTINGS]) {
      var item = this._mockData[_SHEETS.SETTINGS].find(function(s) { return s.Key === key; });
      if (item) {
        item.Value = value;
        item['Updated At'] = new Date().toISOString();
      } else {
        this._mockData[_SHEETS.SETTINGS].push({ Key: key, Value: value, Description: '', 'Updated At': new Date().toISOString() });
      }
      return;
    }

    var sheet = this.getOrCreateSheet(_SHEETS.SETTINGS);
    if (!sheet) return;
    var dataRange = sheet.getDataRange();
    var values = dataRange.getValues();

    for (var i = 1; i < values.length; i++) {
      if (values[i][0] === key) {
        sheet.getRange(i + 1, 2).setValue(value);
        sheet.getRange(i + 1, 4).setValue(new Date().toISOString());
        return;
      }
    }

    var newRow = sheet.getLastRow() + 1;
    sheet.getRange(newRow, 1, 1, 4).setValues([[key, value, '', new Date().toISOString()]]);
  };

  /**
   * Generate sequential/unique ID
   */
  SheetsServiceClass.prototype.generateId = function(prefix) {
    var timestamp = Date.now().toString(36);
    var random = Math.random().toString(36).substring(2, 6);
    return (prefix + timestamp + random).toUpperCase();
  };

  SheetsServiceClass.prototype.generateEmployeeId = function() {
    return this.generateId('EMP');
  };

  SheetsServiceClass.prototype.generateSiteId = function() {
    return this.generateId('SITE');
  };

  SheetsServiceClass.prototype.generateShiftId = function() {
    return this.generateId('SHIFT');
  };

  SheetsServiceClass.prototype.generateOvertimeId = function() {
    return this.generateId('OT');
  };

  SheetsServiceClass.prototype.generateAuditId = function() {
    return this.generateId('AL');
  };

  return new SheetsServiceClass();
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = SheetsService;
}