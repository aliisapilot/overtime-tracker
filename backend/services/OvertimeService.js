/**
 * Overtime Service
 * Handles overtime approval and management workflow
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

var OvertimeService = (function() {
  function OvertimeServiceClass() {}

  /**
   * Log audit record
   */
  OvertimeServiceClass.prototype.logAudit = function(employeeId, action, outcome, details, performedBy) {
    try {
      if (!_SheetsService) return;
      var auditId = _SheetsService.generateAuditId();
      var auditData = {
        ID: auditId,
        'Employee ID': employeeId,
        Action: action,
        Outcome: outcome,
        Timestamp: new Date().toISOString(),
        'Performed By': performedBy || 'Admin',
        Details: details
      };
      _SheetsService.appendRow(_SHEETS.AUDIT_LOGS, auditData);
    } catch (e) {
      if (typeof Logger !== 'undefined') Logger.log('Audit error: ' + e);
    }
  };

  /**
   * Approve or reject overtime record (Admin operation)
   * @param {Object} params - { overtimeId, status, approvedBy, note }
   * @param {Object} session - Validated admin session
   * @returns {Object}
   */
  OvertimeServiceClass.prototype.approveOvertime = function(params, session) {
    try {
      var overtimeId = params.overtimeId;
      var status = params.status;
      var approvedBy = (session && session.name) ? session.name : (params.approvedBy || 'Ateeb');

      if (!overtimeId || !status) {
        return { success: false, message: 'Overtime ID and approval status are required' };
      }

      if (status !== 'Approved' && status !== 'Rejected') {
        return { success: false, message: 'Status must be either "Approved" or "Rejected"' };
      }

      var record = _SheetsService.findById(_SHEETS.OVERTIME, overtimeId);
      if (!record) {
        return { success: false, message: 'Overtime record not found' };
      }

      if (record['Approval Status'] !== 'Pending') {
        return { 
          success: false, 
          message: 'Overtime record has already been processed as ' + record['Approval Status'] + ' on ' + record['Approved At'] 
        };
      }

      var serverTimestamp = new Date().toISOString();
      var updateData = {
        'Approval Status': status,
        'Approved By': approvedBy,
        'Approved At': serverTimestamp
      };

      _SheetsService.updateRow(_SHEETS.OVERTIME, overtimeId, updateData);

      var empId = record['Employee ID'];
      var hours = record['Overtime Hours'];
      this.logAudit(empId, 'Overtime ' + status, 'success', 
        'Overtime record ' + overtimeId + ' (' + hours + 'h) ' + status.toLowerCase() + ' by ' + approvedBy, approvedBy);

      return {
        success: true,
        overtimeId: overtimeId,
        status: status,
        approvedBy: approvedBy,
        approvedAt: serverTimestamp,
        message: 'Overtime record successfully ' + status.toLowerCase()
      };
    } catch (err) {
      if (typeof Logger !== 'undefined') Logger.log('Approve overtime error: ' + err);
      return { success: false, message: 'Failed to process overtime: ' + (err.message || err) };
    }
  };

  /**
   * Get all pending overtime records
   */
  OvertimeServiceClass.prototype.getPendingOvertime = function() {
    var all = _SheetsService.getAllOvertime();
    return all.filter(function(o) { return o['Approval Status'] === 'Pending'; });
  };

  /**
   * Get all overtime records
   */
  OvertimeServiceClass.prototype.getAllOvertime = function() {
    return _SheetsService.getAllOvertime();
  };

  /**
   * Get overtime records for employee
   */
  OvertimeServiceClass.prototype.getEmployeeOvertime = function(employeeId) {
    var all = _SheetsService.getAllOvertime();
    return all.filter(function(o) { return o['Employee ID'] === employeeId; });
  };

  return new OvertimeServiceClass();
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = OvertimeService;
}