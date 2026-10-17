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
  /**
   * Cancel or void overtime record with mandatory reason (Admin operation)
   * @param {Object} params - { overtimeId, reason }
   * @param {Object} session - Validated admin session
   * @returns {Object}
   */
  OvertimeServiceClass.prototype.voidOvertime = function(params, session) {
    try {
      var overtimeId = (params.overtimeId || params.id || '').trim();
      var reason = (params.reason || params.voidReason || '').trim();
      var performedBy = (session && session.name) ? session.name : (params.performedBy || 'Ateeb');

      if (!overtimeId) {
        return { success: false, message: 'Overtime ID is required' };
      }

      if (!reason) {
        return { success: false, message: 'A mandatory reason is required to cancel or void overtime.' };
      }

      var record = _SheetsService.findById(_SHEETS.OVERTIME, overtimeId);
      if (!record) {
        return { success: false, message: 'Overtime record not found: ' + overtimeId };
      }

      if (record['Approval Status'] === 'Cancelled' || record['Approval Status'] === 'Voided') {
        return { success: false, message: 'Overtime record is already ' + record['Approval Status'].toLowerCase() };
      }

      var serverTimestamp = new Date().toISOString();
      var updateData = {
        'Approval Status': 'Cancelled',
        'Void Reason': reason,
        'Voided At': serverTimestamp,
        'Voided By': performedBy
      };

      _SheetsService.updateRow(_SHEETS.OVERTIME, overtimeId, updateData);

      var empId = record['Employee ID'];
      var hours = record['Overtime Hours'];
      this.logAudit(empId, 'void_overtime', 'success',
        'Cancelled overtime record ' + overtimeId + ' (' + hours + 'h). Reason: ' + reason, performedBy);

      return {
        success: true,
        overtimeId: overtimeId,
        status: 'Cancelled',
        voidReason: reason,
        voidedAt: serverTimestamp,
        voidedBy: performedBy,
        message: 'Overtime record cancelled successfully'
      };
    } catch (err) {
      if (typeof Logger !== 'undefined') Logger.log('Void overtime error: ' + err);
      return { success: false, message: 'Failed to cancel overtime: ' + (err.message || err) };
    }
  };

  return new OvertimeServiceClass();
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = OvertimeService;
}