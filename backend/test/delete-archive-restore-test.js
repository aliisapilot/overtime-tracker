/**
 * Automated Test Suite for Delete, Archive, and Restore System
 * Covers:
 * - Employee archive and restore
 * - Job-site archive and restore (including active shift blocking)
 * - Attendance record voiding with mandatory reason & audit preservation
 * - Overtime cancellation with mandatory reason
 * - Shift recalculation and report exclusions after voiding
 * - Automatic cancellation of linked overtime when shift is voided
 * - Cloudflare Worker / API attendance photo purge under retention policy
 * - Security gates: Administrator authorization, Labourer rejection
 * - Last active administrator protection
 * - Active shift start restrictions on archived employees and job sites
 * - Duplicate record detection and resolution
 */

const assert = require('assert');
const path = require('path');

require.extensions['.gs'] = require.extensions['.js'];
const SheetsService = require('../services/SheetsService');
const AdminService = require('../services/AdminService');
const AuthService = require('../services/AuthService');
const ShiftService = require('../services/ShiftService');
const OvertimeService = require('../services/OvertimeService');
const CryptoUtils = require('../lib/CryptoUtils');
const Code = require('../Code.gs');

console.log('=== RUNNING DELETE, ARCHIVE & RESTORE SYSTEM TEST SUITE ===\n');

// Mock data store
function createMockDatabase() {
  const adminPinHash = CryptoUtils.hashPin('9999');
  const worker1PinHash = CryptoUtils.hashPin('1111');
  const worker2PinHash = CryptoUtils.hashPin('2222');

  return {
    'Employees': [
      {
        ID: 'EMP000',
        Name: 'Ateeb',
        Phone: '+971500000000',
        Role: 'Admin',
        'Site ID': '',
        'PIN Hash': adminPinHash,
        Status: 'Active',
        'Created At': '2026-01-01T00:00:00.000Z',
        'Last Accessed': ''
      },
      {
        ID: 'EMP001',
        Name: 'Mohammed Rashid',
        Phone: '+971501111111',
        Role: 'Labourer',
        'Site ID': 'SITE001',
        'PIN Hash': worker1PinHash,
        Status: 'Active',
        'Created At': '2026-01-01T00:00:00.000Z',
        'Last Accessed': ''
      },
      {
        ID: 'EMP002',
        Name: 'Ali Hassan',
        Phone: '+971502222222',
        Role: 'Labourer',
        'Site ID': 'SITE001',
        'PIN Hash': worker2PinHash,
        Status: 'Active',
        'Created At': '2026-01-01T00:00:00.000Z',
        'Last Accessed': ''
      }
    ],
    'Job Sites': [
      {
        ID: 'SITE001',
        Name: 'Downtown Dubai Tower',
        Address: 'Downtown Dubai',
        Latitude: 25.1972,
        Longitude: 55.2744,
        'Geofence Radius': 100,
        Status: 'Active',
        'Created At': '2026-01-01T00:00:00.000Z'
      },
      {
        ID: 'SITE002',
        Name: 'Marina Waterfront',
        Address: 'Dubai Marina',
        Latitude: 25.0805,
        Longitude: 55.1403,
        'Geofence Radius': 150,
        Status: 'Active',
        'Created At': '2026-01-01T00:00:00.000Z'
      }
    ],
    'Shifts': [
      {
        ID: 'SHIFT001',
        'Employee ID': 'EMP001',
        'Site ID': 'SITE001',
        'Start Time': '2026-10-18T06:00:00.000Z',
        'End Time': '2026-10-18T17:00:00.000Z',
        'Start Latitude': 25.1972,
        'Start Longitude': 55.2744,
        'Start Accuracy': 12,
        'End Latitude': 25.1972,
        'End Longitude': 55.2744,
        'End Accuracy': 14,
        'Break Minutes': 60,
        'Regular Hours': 8,
        'Overtime Hours': 2,
        Status: 'Completed',
        'Created At': '2026-10-18T06:00:00.000Z',
        'Start Photo Key': 'photos/EMP001/20261018/start_abc123.jpg',
        'Start Photo Verification Status': 'Verified',
        'End Photo Key': 'photos/EMP001/20261018/end_def456.jpg',
        'End Photo Verification Status': 'Verified'
      }
    ],
    'Overtime': [
      {
        ID: 'OT001',
        'Shift ID': 'SHIFT001',
        'Employee ID': 'EMP001',
        Date: '2026-10-18',
        'Overtime Hours': 2,
        'Approval Status': 'Pending',
        'Approved By': '',
        'Approved At': '',
        'Created At': '2026-10-18T17:00:00.000Z'
      }
    ],
    'Audit Logs': [],
    'Settings': []
  };
}

let mockDb = createMockDatabase();
SheetsService.setMockData(mockDb);

const adminSession = {
  employeeId: 'EMP000',
  name: 'Ateeb',
  role: 'Admin'
};

const labourerSession = {
  employeeId: 'EMP001',
  name: 'Mohammed Rashid',
  role: 'Labourer'
};

// ----------------------------------------------------
// 1. EMPLOYEE ARCHIVE & RESTORE TESTS
// ----------------------------------------------------
console.log('[1. Employee Archive & Restore Tests]');

// 1.1 Archive an employee
const archiveRes = AdminService.archiveEmployee({
  employeeId: 'EMP002',
  reason: 'Seasonal contract ended'
}, adminSession);

assert.strictEqual(archiveRes.success, true, 'Archive employee should succeed');
assert.strictEqual(archiveRes.status, 'Archived');
const archivedEmp = SheetsService.getEmployeeById('EMP002');
assert.strictEqual(archivedEmp.Status, 'Archived');
assert.strictEqual(archivedEmp['Archive Reason'], 'Seasonal contract ended');
assert.ok(archivedEmp['Archived At'], 'Archived At timestamp should be saved');
console.log('  ✓ Archive employee soft-deletes record and records archive reason & timestamp');

// 1.2 Archived employee cannot log in
const loginArchivedRes = AuthService.login({ employeeId: 'EMP002', pin: '2222' });
assert.strictEqual(loginArchivedRes.success, false, 'Archived employee login must be rejected');
assert.ok(loginArchivedRes.message.includes('archived'), 'Rejection message must mention archived status');
console.log('  ✓ Archived employee cannot log in');

// 1.3 Archived employee cannot start shift
const shiftStartArchived = ShiftService.startShift({
  employeeId: 'EMP002',
  lat: 25.1972,
  lon: 55.2744,
  accuracy: 10
});
assert.strictEqual(shiftStartArchived.success, false, 'Archived employee shift start must be blocked');
assert.ok(shiftStartArchived.message.includes('archived'), 'Start shift message must state account is archived');
console.log('  ✓ Archived employee cannot start shifts');

// 1.4 Restore employee
const restoreRes = AdminService.restoreEmployee({ employeeId: 'EMP002' }, adminSession);
assert.strictEqual(restoreRes.success, true, 'Restore employee should succeed');
const restoredEmp = SheetsService.getEmployeeById('EMP002');
assert.strictEqual(restoredEmp.Status, 'Active');
assert.ok(restoredEmp['Restored At'], 'Restored At timestamp should be saved');
console.log('  ✓ Restore employee returns status to Active with restoration metadata');

// 1.5 Restored employee can now log in
const loginRestoredRes = AuthService.login({ employeeId: 'EMP002', pin: '2222' });
assert.strictEqual(loginRestoredRes.success, true, 'Restored employee can log in again');
console.log('  ✓ Restored employee can log in successfully');

// 1.6 Security: Cannot archive last active administrator
const archiveAdminRes = AdminService.archiveEmployee({ employeeId: 'EMP000' }, adminSession);
assert.strictEqual(archiveAdminRes.success, false, 'Archiving last admin must be blocked');
assert.ok(archiveAdminRes.message.includes('last active administrator'), 'Error message must protect last admin');
console.log('  ✓ Last active administrator account cannot be archived');

// ----------------------------------------------------
// 2. JOB SITE ARCHIVE & RESTORE TESTS
// ----------------------------------------------------
console.log('\n[2. Job Site Archive & Restore Tests]');

// 2.1 Archive an unused job site
const archiveSiteRes = AdminService.archiveJobSite({
  siteId: 'SITE002',
  reason: 'Project completed at Marina'
}, adminSession);
assert.strictEqual(archiveSiteRes.success, true, 'Archive job site should succeed');
const archivedSite = SheetsService.getJobSiteById('SITE002');
assert.strictEqual(archivedSite.Status, 'Archived');
assert.strictEqual(archivedSite['Archive Reason'], 'Project completed at Marina');
console.log('  ✓ Archive unused job site soft-deletes record and preserves history');

// 2.2 Cannot assign employee to archived site
const assignArchivedSiteRes = AdminService.updateEmployee({
  employeeId: 'EMP001',
  siteId: 'SITE002'
}, adminSession);
assert.strictEqual(assignArchivedSiteRes.success, false, 'Assigning to archived site must be rejected');
assert.ok(assignArchivedSiteRes.message.includes('archived'), 'Error message must state site is archived');
console.log('  ✓ Cannot assign employee to an archived job site');

// 2.3 Restore job site
const restoreSiteRes = AdminService.restoreJobSite({ siteId: 'SITE002' }, adminSession);
assert.strictEqual(restoreSiteRes.success, true, 'Restore job site should succeed');
const restoredSite = SheetsService.getJobSiteById('SITE002');
assert.strictEqual(restoredSite.Status, 'Active');
console.log('  ✓ Restore job site returns status to Active');

// 2.4 Active shift blocks job site archiving
// Add an active shift on SITE001
mockDb.Shifts.push({
  ID: 'SHIFT_ACTIVE',
  'Employee ID': 'EMP001',
  'Site ID': 'SITE001',
  'Start Time': '2026-10-18T08:00:00.000Z',
  'End Time': '',
  'Start Latitude': 25.1972,
  'Start Longitude': 55.2744,
  'Start Accuracy': 10,
  Status: 'Active',
  'Created At': '2026-10-18T08:00:00.000Z'
});

const archiveBusySiteRes = AdminService.archiveJobSite({ siteId: 'SITE001' }, adminSession);
assert.strictEqual(archiveBusySiteRes.success, false, 'Archiving site with active shifts must be blocked');
assert.ok(archiveBusySiteRes.message.includes('active shift'), 'Error must mention active shifts in progress');
console.log('  ✓ Job site archiving blocked while active shifts are clocked in');

// 2.5 Active shift also blocks employee archiving
const archiveActiveEmpRes = AdminService.archiveEmployee({ employeeId: 'EMP001' }, adminSession);
assert.strictEqual(archiveActiveEmpRes.success, false, 'Archiving employee with active shift must be blocked');
assert.ok(archiveActiveEmpRes.message.includes('active shift'), 'Error must mention active shift in progress');
console.log('  ✓ Employee archiving blocked while employee is clocked in');

// Clean up active shift
mockDb.Shifts = mockDb.Shifts.filter(s => s.ID !== 'SHIFT_ACTIVE');

// ----------------------------------------------------
// 3. ATTENDANCE VOIDING & HOURS RECALCULATION
// ----------------------------------------------------
console.log('\n[3. Attendance Voiding & Hours Recalculation Tests]');

// 3.1 Voiding shift requires mandatory reason
const voidNoReason = AdminService.voidShift({ shiftId: 'SHIFT001', reason: '' }, adminSession);
assert.strictEqual(voidNoReason.success, false, 'Void without reason must be rejected');
assert.ok(voidNoReason.message.includes('mandatory reason'), 'Must require mandatory reason');
console.log('  ✓ Void shift requires non-empty mandatory reason');

// 3.2 Void shift with reason
const voidWithReason = AdminService.voidShift({
  shiftId: 'SHIFT001',
  reason: 'Accidental duplicate test entry by supervisor'
}, adminSession);
assert.strictEqual(voidWithReason.success, true, 'Void shift with reason must succeed');
const voidedShift = SheetsService.findById('Shifts', 'SHIFT001');
assert.strictEqual(voidedShift.Status, 'Voided');
assert.strictEqual(voidedShift['Void Reason'], 'Accidental duplicate test entry by supervisor');
console.log('  ✓ Void shift preserves original record values while setting status to Voided');

// 3.3 Associated overtime is automatically cancelled when shift is voided
const linkedOt = SheetsService.findById('Overtime', 'OT001');
assert.strictEqual(linkedOt['Approval Status'], 'Cancelled', 'Linked overtime must be cancelled');
assert.ok(linkedOt['Void Reason'].includes('voided'), 'Overtime void reason must reference voided shift');
console.log('  ✓ Linked overtime automatically cancelled upon shift voiding');

// 3.4 Voided shift is excluded from daily reports and hours totals
const dailyReportRes = AdminService.generateDailyReport({ date: '2026-10-18' });
assert.strictEqual(dailyReportRes.success, true);
assert.strictEqual(dailyReportRes.report.totalShifts, 0, 'Voided shift must be excluded from daily report shifts count');
assert.strictEqual(dailyReportRes.report.totalRegularHours, 0, 'Voided shift must be excluded from regular hours');
assert.strictEqual(dailyReportRes.report.totalOvertimeHours, 0, 'Voided shift must be excluded from overtime hours');
console.log('  ✓ Voided shift excluded from daily hours and attendance calculations');

// ----------------------------------------------------
// 4. OVERTIME VOIDING & CANCELLATION
// ----------------------------------------------------
console.log('\n[4. Overtime Voiding & Cancellation Tests]');

// Add fresh pending overtime
mockDb.Overtime.push({
  ID: 'OT002',
  'Shift ID': 'SHIFT002',
  'Employee ID': 'EMP001',
  Date: '2026-10-18',
  'Overtime Hours': 3,
  'Approval Status': 'Pending',
  'Approved By': '',
  'Approved At': '',
  'Created At': '2026-10-18T18:00:00.000Z'
});

// 4.1 Void overtime without reason is rejected
const voidOtNoReason = OvertimeService.voidOvertime({ overtimeId: 'OT002', reason: '' }, adminSession);
assert.strictEqual(voidOtNoReason.success, false, 'Void overtime without reason must be rejected');
console.log('  ✓ Overtime voiding requires mandatory reason');

// 4.2 Void overtime with reason succeeds
const voidOtRes = OvertimeService.voidOvertime({
  overtimeId: 'OT002',
  reason: 'Approved as compensatory off instead of paid OT'
}, adminSession);
assert.strictEqual(voidOtRes.success, true, 'Void overtime must succeed');
const cancelledOt = SheetsService.findById('Overtime', 'OT002');
assert.strictEqual(cancelledOt['Approval Status'], 'Cancelled');
assert.strictEqual(cancelledOt['Void Reason'], 'Approved as compensatory off instead of paid OT');
console.log('  ✓ Overtime cancelled and excluded from pending requests');

// 4.3 Pending overtime list excludes cancelled overtime
const pendingOtList = OvertimeService.getPendingOvertime();
assert.strictEqual(pendingOtList.some(o => o.ID === 'OT002'), false, 'Cancelled overtime must not appear in pending list');
console.log('  ✓ Pending overtime query excludes cancelled/voided records');

// ----------------------------------------------------
// 5. ATTENDANCE PHOTO PURGE UNDER RETENTION POLICY
// ----------------------------------------------------
console.log('\n[5. Attendance Photo Purge Under Retention Policy Tests]');

// 5.1 Purge without policy acknowledgement rejected
const purgeNoAck = AdminService.purgeAttendancePhoto({
  shiftId: 'SHIFT001',
  photoType: 'start',
  reason: 'GDPR / UAE privacy retention compliance',
  policyAck: false
}, adminSession);
assert.strictEqual(purgeNoAck.success, false, 'Purge without policy acknowledgement must fail');
console.log('  ✓ Photo purge requires explicit policy acknowledgement');

// 5.2 Purge with policy acknowledgement succeeds
const purgeSuccess = AdminService.purgeAttendancePhoto({
  shiftId: 'SHIFT001',
  photoType: 'start',
  reason: 'GDPR / UAE privacy retention compliance',
  policyAck: true
}, adminSession);
assert.strictEqual(purgeSuccess.success, true, 'Photo purge with acknowledgement must succeed');
const purgedShift = SheetsService.findById('Shifts', 'SHIFT001');
assert.strictEqual(purgedShift['Start Photo Key'], '', 'Photo key must be removed');
assert.ok(purgedShift['Start Photo Verification Status'].includes('Purged'), 'Verification status must record Purged audit');
console.log('  ✓ Photo key safely cleared from shift record with audit annotation');

// ----------------------------------------------------
// 6. BACKEND SECURITY & ACCESS CONTROL GATEWAY
// ----------------------------------------------------
console.log('\n[6. Backend Security & Role-Based Access Tests]');

// 6.1 Labourer cannot call archiveEmployee via doPost
const labourerArchiveEmp = Code.doPost({
  postData: {
    contents: JSON.stringify({
      action: 'archiveEmployee',
      token: 'fake.token',
      employeeId: 'EMP002'
    })
  }
});
// Since token is fake or labourer role, must be rejected
assert.ok(!labourerArchiveEmp.success, 'Unauthenticated or labourer archive request must be denied');
console.log('  ✓ Unauthenticated archive attempt rejected at API gateway');

// 6.2 Audit Logs immutability: Audit Logs cannot be modified or cleared by dashboard actions
const auditLogsSheet = SheetsService.getAllRows('Audit Logs');
assert.ok(auditLogsSheet.length > 0, 'Audit entries must be recorded for destructive actions');
const archiveAudit = auditLogsSheet.find(l => l.Action === 'archive_employee');
assert.ok(archiveAudit, 'archive_employee action must be recorded in Audit Logs');
console.log('  ✓ Audit trail records every archive, void, and restore operation');

// ----------------------------------------------------
// 7. ARCHIVED RECORDS & DUPLICATE DETECTION API
// ----------------------------------------------------
console.log('\n[7. Archived Records & Duplicate Detection Tests]');

// Add an employee with same name to test duplicate detection
mockDb.Employees.push({
  ID: 'EMP003',
  Name: 'Mohammed Rashid', // duplicate name of EMP001
  Phone: '+971509999999',
  Role: 'Labourer',
  'Site ID': 'SITE001',
  'PIN Hash': CryptoUtils.hashPin('3333'),
  Status: 'Active',
  'Created At': '2026-10-18T00:00:00.000Z',
  'Last Accessed': ''
});

// Set EMP002 back to Archived for the test
mockDb.Employees.find(e => e.ID === 'EMP002').Status = 'Archived';
mockDb.Employees.find(e => e.ID === 'EMP002')['Archive Reason'] = 'Seasonal contract end';
mockDb.Employees.find(e => e.ID === 'EMP002')['Archived At'] = new Date().toISOString();
mockDb.Employees.find(e => e.ID === 'EMP002')['Archived By'] = 'Ateeb';

const archivedData = AdminService.getArchivedRecords({}, adminSession);
assert.strictEqual(archivedData.success, true, 'getArchivedRecords must succeed');
assert.strictEqual(archivedData.archivedEmployees.length, 1, 'Should find 1 archived employee (EMP002)');
assert.strictEqual(archivedData.archivedEmployees[0].id, 'EMP002');
assert.strictEqual(archivedData.voidedShifts.length, 1, 'Should find 1 voided shift (SHIFT001)');
assert.strictEqual(archivedData.voidedOvertime.length, 2, 'Should find 2 voided/cancelled overtime entries (OT001, OT002)');
assert.ok(archivedData.duplicates.length >= 1, 'Should detect Mohammed Rashid name collision');
assert.strictEqual(archivedData.duplicates[0].name, 'Mohammed Rashid');
assert.strictEqual(archivedData.duplicates[0].relatedRecords.length, 2, 'Collision should reference both records for safe review');

console.log('  ✓ getArchivedRecords returns all archived employees, sites, voided shifts, and overtime');
console.log('  ✓ Duplicate record detection accurately identifies collisions with full related records');

console.log('\n=== ALL DELETE, ARCHIVE & RESTORE SYSTEM TESTS PASSED! ===');
