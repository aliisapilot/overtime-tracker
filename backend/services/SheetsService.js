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
    this._rowCache = {};   // Per-request in-memory cache: { sheetName: rows[] }
    this._headerCache = {};// In-request header cache: { sheetName: headers[] }
    this._spreadsheet = null;
  }

  /**
   * Set mock data for local automated testing
   */
  SheetsServiceClass.prototype.setMockData = function(data) {
    this._mockData = data;
    this._rowCache = {};
    this._headerCache = {};
  };

  /**
   * Get the active spreadsheet
   * @returns {GoogleAppsScript.Spreadsheet.Spreadsheet}
   */
  SheetsServiceClass.prototype.getSpreadsheet = function() {
    if (this._spreadsheet) {
      return this._spreadsheet;
    }
    if (typeof SpreadsheetApp !== 'undefined') {
      this._spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
      return this._spreadsheet;
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
      'ID', 'Name', 'Phone', 'Role', 'Site ID', 'PIN Hash', 'Status', 'Created At', 'Last Accessed',
      'Archived At', 'Archived By', 'Archive Reason', 'Restored At', 'Restored By', 'Display ID'
    ]);

    // 2. Job Sites sheet (Headers only - NO sample production sites)
    var jobSitesSheet = this.getOrCreateSheet(_SHEETS.JOB_SITES);
    this.ensureHeaders(jobSitesSheet, [
      'ID', 'Name', 'Address', 'Latitude', 'Longitude', 'Geofence Radius', 'Status', 'Created At',
      'Archived At', 'Archived By', 'Archive Reason', 'Restored At', 'Restored By', 'Display ID'
    ]);

    // 3. Shifts sheet (Extended with photo verification fields)
    var shiftsSheet = this.getOrCreateSheet(_SHEETS.SHIFTS);
    this.ensureHeaders(shiftsSheet, [
      'ID', 'Employee ID', 'Site ID', 'Start Time', 'End Time',
      'Start Latitude', 'Start Longitude', 'Start Accuracy',
      'End Latitude', 'End Longitude', 'End Accuracy',
      'Break Minutes', 'Regular Hours', 'Overtime Hours', 'Status', 'Created At',
      'Start Photo Key', 'Start Photo Captured At', 'Start Photo Verification Status',
      'End Photo Key', 'End Photo Captured At', 'End Photo Verification Status',
      'Void Reason', 'Voided At', 'Voided By'
    ]);

    // 4. Overtime sheet
    var overtimeSheet = this.getOrCreateSheet(_SHEETS.OVERTIME);
    this.ensureHeaders(overtimeSheet, [
      'ID', 'Shift ID', 'Employee ID', 'Date', 'Overtime Hours',
      'Approval Status', 'Approved By', 'Approved At', 'Created At',
      'Void Reason', 'Voided At', 'Voided By'
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
   * Ensure sheet has required headers without deleting data.
   * If existing columns are present, any missing headers are safely appended to row 1.
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

    var range = sheet.getRange(1, 1, 1, lastCol);
    var existingHeaders = range.getValues()[0];
    var isBlank = existingHeaders.every(function(h) { return h === ''; });

    if (isBlank) {
      var headerRange = sheet.getRange(1, 1, 1, headers.length);
      headerRange.setValues([headers]);
      headerRange.setFontWeight('bold');
      headerRange.setBackground('#1e3a8a');
      headerRange.setFontColor('#ffffff');
      sheet.setFrozenRows(1);
      return;
    }

    // Safely append any missing columns at the end of row 1 without altering existing data rows
    var missingHeaders = [];
    headers.forEach(function(h) {
      if (existingHeaders.indexOf(h) === -1) {
        missingHeaders.push(h);
      }
    });

    if (missingHeaders.length > 0) {
      var newColStart = lastCol + 1;
      var newHeaderRange = sheet.getRange(1, newColStart, 1, missingHeaders.length);
      newHeaderRange.setValues([missingHeaders]);
      newHeaderRange.setFontWeight('bold');
      newHeaderRange.setBackground('#1e3a8a');
      newHeaderRange.setFontColor('#ffffff');
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
    if (!sheet && !this._mockData) {
      sheet = this.getOrCreateSheet(_SHEETS.EMPLOYEES);
    }
    
    // Check if EMP000 already exists
    var existingAdmin = this.findById(_SHEETS.EMPLOYEES, 'EMP000');

    var configuredPin = null;
    if (typeof PropertiesService !== 'undefined' && PropertiesService.getScriptProperties) {
      var props = PropertiesService.getScriptProperties();
      configuredPin = props.getProperty('ADMIN_PIN');
    } else if (this._mockAdminPin) {
      configuredPin = this._mockAdminPin;
    }

    if (!configuredPin) {
      if (existingAdmin && existingAdmin.Status === 'Active') {
        return { created: false, message: 'Admin account EMP000 is already active.' };
      }

      if (typeof Logger !== 'undefined') {
        Logger.log('[SECURITY NOTICE] To activate Administrator account (EMP000), set Script Property "ADMIN_PIN" in Project Settings and run activateAdmin() (or init()).');
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
      return { created: false, message: 'Admin account pending setup. Add Script Property ADMIN_PIN and run activateAdmin().' };
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

    // Immediately and securely delete plain text ADMIN_PIN property and any legacy tokens
    if (typeof PropertiesService !== 'undefined' && PropertiesService.getScriptProperties) {
      PropertiesService.getScriptProperties().deleteProperty('ADMIN_PIN');
      PropertiesService.getScriptProperties().deleteProperty('ONE_TIME_SETUP_TOKEN');
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
   * Uses an in-request cache to avoid multiple full-sheet reads per GAS execution.
   * @param {string} sheetName
   * @returns {Object[]}
   */
  SheetsServiceClass.prototype.getAllRows = function(sheetName) {
    if (this._mockData && this._mockData[sheetName]) {
      return this._mockData[sheetName];
    }

    // Return cached rows if already loaded during this GAS execution
    if (this._rowCache[sheetName]) {
      return this._rowCache[sheetName];
    }

    // Check Google Apps Script distributed ScriptCache for reference data
    var cacheKey = 'ss_cache_' + sheetName;
    if (typeof CacheService !== 'undefined' && CacheService.getScriptCache &&
        (sheetName === _SHEETS.JOB_SITES || sheetName === _SHEETS.EMPLOYEES)) {
      try {
        var cachedJson = CacheService.getScriptCache().get(cacheKey);
        if (cachedJson) {
          var parsed = JSON.parse(cachedJson);
          if (Array.isArray(parsed)) {
            this._rowCache[sheetName] = parsed;
            return parsed;
          }
        }
      } catch (cacheReadErr) {
        // Fall back to sheet read
      }
    }

    var sheet = this.getOrCreateSheet(sheetName);
    if (!sheet) return [];
    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) {
      this._rowCache[sheetName] = [];
      return this._rowCache[sheetName];
    }

    var headers = data[0];
    this._headerCache[sheetName] = headers;
    this._rowCache[sheetName] = data.slice(1).map(function(row) {
      var obj = {};
      headers.forEach(function(header, i) {
        if (header) {
          obj[header] = row[i];
        }
      });
      return obj;
    });

    // Populate Google Apps Script ScriptCache for reference tables
    if (typeof CacheService !== 'undefined' && CacheService.getScriptCache &&
        (sheetName === _SHEETS.JOB_SITES || sheetName === _SHEETS.EMPLOYEES)) {
      try {
        var ttl = sheetName === _SHEETS.JOB_SITES ? 600 : 300; // 10m sites, 5m employees
        var str = JSON.stringify(this._rowCache[sheetName]);
        if (str.length < 95000) { // Keep safely within 100KB CacheService limit
          CacheService.getScriptCache().put(cacheKey, str, ttl);
        }
      } catch (cacheWriteErr) {
        // Cache put failed (e.g. payload exceeded), continue safely without cache
      }
    }

    return this._rowCache[sheetName];
  };

  /**
   * Invalidate both in-request and distributed ScriptCache for a sheet after a write
   * @param {string} sheetName
   */
  SheetsServiceClass.prototype._invalidateCache = function(sheetName) {
    delete this._rowCache[sheetName];
    delete this._headerCache[sheetName];
    if (typeof CacheService !== 'undefined' && CacheService.getScriptCache) {
      try {
        CacheService.getScriptCache().remove('ss_cache_' + sheetName);
      } catch (e) {}
    }
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
   * Append a new row with cached header lookup
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
    // Ensure all keys in data exist as columns in the sheet
    if (data && typeof data === 'object') {
      this.ensureHeaders(sheet, Object.keys(data));
      this._headerCache[sheetName] = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    }
    var headers = this._headerCache[sheetName];
    if (!headers) {
      headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      this._headerCache[sheetName] = headers;
    }
    var rowData = headers.map(function(h) { return data[h] !== undefined ? data[h] : ''; });
    var newRow = sheet.getLastRow() + 1;
    sheet.getRange(newRow, 1, 1, rowData.length).setValues([rowData]);
    // Invalidate cache so subsequent reads see the new row
    this._invalidateCache(sheetName);
    return data;
  };

  /**
   * Update a row by ID with cached headers
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

    // Dynamically ensure columns exist for any new metadata fields being written
    if (data && typeof data === 'object') {
      this.ensureHeaders(sheet, Object.keys(data));
      this._headerCache[sheetName] = null; // force reload headers
    }

    var dataRange = sheet.getDataRange();
    var values = dataRange.getValues();
    if (values.length <= 1) return false;
    var headers = values[0];
    this._headerCache[sheetName] = headers;

    for (var i = 1; i < values.length; i++) {
      if (String(values[i][0]) === String(id)) {
        var rowData = headers.map(function(h) {
          return data[h] !== undefined ? data[h] : values[i][headers.indexOf(h)];
        });
        sheet.getRange(i + 1, 1, 1, rowData.length).setValues([rowData]);
        // Invalidate cache for this sheet after write
        this._invalidateCache(sheetName);
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
    var employees = this.getAllEmployees();
    var maxNum = 0;
    employees.forEach(function(e) {
      var match = String(e.ID || '').match(/^EMP(\d+)$/i);
      if (match) {
        var num = parseInt(match[1], 10);
        if (num > maxNum) maxNum = num;
      }
    });
    var nextNum = maxNum + 1;
    var padded = nextNum < 1000 ? ('000' + nextNum).slice(-3) : String(nextNum);
    return 'EMP' + padded;
  };

  SheetsServiceClass.prototype.generateSiteId = function() {
    var sites = this.getAllJobSites();
    var maxNum = 0;
    sites.forEach(function(s) {
      var match = String(s.ID || s.id || '').match(/^SITE(\d+)$/i);
      if (match) {
        var num = parseInt(match[1], 10);
        if (num > maxNum) maxNum = num;
      }
    });
    var nextNum = maxNum + 1;
    var padded = nextNum < 1000 ? ('000' + nextNum).slice(-3) : String(nextNum);
    return 'SITE' + padded;
  };

  /**
   * Deterministic, collision-free Display ID computation (EMP001, SITE001)
   * Stable across refreshes, devices, and deployments. Does not depend on row position.
   */
  SheetsServiceClass.prototype.computeDeterministicDisplayId = function(item, allItems, prefix) {
    if (!item) return '';
    var rawId = String(item.ID || item.id || '').trim().toUpperCase();
    if (!rawId) return '';
    if (prefix === 'EMP' && rawId === 'EMP000') return 'EMP000';

    var regex = new RegExp('^' + prefix + '(\\d+)$', 'i');
    var directMatch = rawId.match(regex);
    if (directMatch) {
      var numVal = parseInt(directMatch[1], 10);
      var padVal = numVal < 1000 ? ('000' + numVal).slice(-3) : String(numVal);
      return prefix + padVal;
    }

    if (item['Display ID']) return String(item['Display ID']).trim();
    if (item.displayId) return String(item.displayId).trim();

    // Map used numbers
    var usedNumbers = {};
    for (var i = 0; i < allItems.length; i++) {
      var it = allItems[i];
      var itId = String(it.ID || it.id || '').trim().toUpperCase();
      var dispId = String(it['Display ID'] || it.displayId || '').trim().toUpperCase();
      var m = (dispId && dispId.match(regex)) || itId.match(regex);
      if (m) {
        usedNumbers[parseInt(m[1], 10)] = true;
      }
    }

    // Sort remaining items by Created At, then ID
    var remaining = allItems.filter(function(it) {
      var itId = String(it.ID || it.id || '').trim().toUpperCase();
      return itId && !itId.match(regex) && !(it['Display ID'] || it.displayId);
    });

    remaining.sort(function(a, b) {
      var tA = new Date(a['Created At'] || a.createdAt || 0).getTime() || 0;
      var tB = new Date(b['Created At'] || b.createdAt || 0).getTime() || 0;
      if (tA !== tB) return tA - tB;
      var idA = String(a.ID || a.id || '').toUpperCase();
      var idB = String(b.ID || b.id || '').toUpperCase();
      return idA.localeCompare(idB);
    });

    var nextNum = 1;
    for (var j = 0; j < remaining.length; j++) {
      var curId = String(remaining[j].ID || remaining[j].id || '').trim().toUpperCase();
      while (usedNumbers[nextNum]) {
        nextNum++;
      }
      var assigned = prefix + (nextNum < 1000 ? ('000' + nextNum).slice(-3) : String(nextNum));
      usedNumbers[nextNum] = true;
      if (curId === rawId) {
        return assigned;
      }
      nextNum++;
    }

    return prefix + '001';
  };

  SheetsServiceClass.prototype.getEmployeeDisplayId = function(emp, allEmployees) {
    if (!allEmployees) allEmployees = this.getAllEmployees();
    return this.computeDeterministicDisplayId(emp, allEmployees, 'EMP');
  };

  SheetsServiceClass.prototype.getJobSiteDisplayId = function(site, allSites) {
    if (!allSites) allSites = this.getAllJobSites();
    return this.computeDeterministicDisplayId(site, allSites, 'SITE');
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