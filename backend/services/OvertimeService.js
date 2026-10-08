const CONFIG = require('../lib/Config');
const SheetsService = require('./SheetsService');

/**
 * Overtime Service
 * Handles overtime approval and management
 */
class OvertimeService {
  constructor() {
    this.sheets = SheetsService;
  }

  /**
   * Approve or reject overtime
   * @param {Object} params - Request parameters
   * @returns {Object} Approval result
   */
  approveOvertime(params) {
    try {
      const { overtimeId, status, approvedBy } = params;
      
      if (!overtimeId || !status) {
        return this.errorResponse('Overtime ID and status required');
      }

      if (!['Approved', 'Rejected'].includes(status)) {
        return this.errorResponse('Status must be Approved or Rejected');
      }

      const overtime = this.sheets.findById(CONFIG.SHEETS.OVERTIME, overtimeId);
      if (!overtime) {
        return this.errorResponse('Overtime record not found');
      }

      if (overtime['Approval Status'] !== 'Pending') {
        return this.errorResponse('Overtime already processed');
      }

      const updateData = {
        'Approval Status': status,
        'Approved By': approvedBy || 'Admin',
        'Approved At': new Date().toISOString()
      };

      this.sheets.updateRow(CONFIG.SHEETS.OVERTIME, overtimeId, updateData);

      // Log audit
      this.logAudit(overtime['Employee ID'], 'Overtime ' + status, 'success', 
        `Overtime ${overtimeId} ${status.toLowerCase()} by ${approvedBy}`);

      return {
        success: true,
        overtimeId,
        status,
        message: `Overtime ${status.toLowerCase()}`
      };
    } catch (error) {
      logError('Approve overtime error', error);
      return this.errorResponse('Failed to process overtime');
    }
  }

  /**
   * Get pending overtime records
   * @returns {Object[]}
   */
  getPendingOvertime() {
    const overtime = this.sheets.getAllOvertime();
    return overtime.filter(o => o['Approval Status'] === 'Pending');
  }

  /**
   * Get all overtime records
   * @returns {Object[]}
   */
  getAllOvertime() {
    return this.sheets.getAllOvertime();
  }

  /**
   * Get overtime for employee
   * @param {string} employeeId
   * @returns {Object[]}
   */
  getEmployeeOvertime(employeeId) {
    const overtime = this.sheets.getAllOvertime();
    return overtime.filter(o => o['Employee ID'] === employeeId);
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
      logError('Failed to log audit', error);
    }
  }

  errorResponse(message) {
    return { success: false, message };
  }
}

module.exports = new OvertimeService();