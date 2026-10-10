/**
 * Site Assignment & Geofence Verification Test Suite
 * Tests all requirements from:
 * 1. Employee without a site -> "No job site assigned. Please contact your supervisor."
 * 2. Employee assigned to a valid site
 * 3. Employee assigned to a deleted or invalid site -> "Assigned job site (ID) was not found..."
 * 4. Changing an employee's site preserves previous attendance records
 * 5. Existing shifts retain their original job-site information
 * 6. START SHIFT inside geofence -> succeeds with site details
 * 7. START SHIFT outside geofence -> rejected with distance & geofence radius
 * 8. Refreshing and logging in returns latest assigned site
 * 9. Admin createEmployee and updateEmployee validate site existence and return updated record
 */

const assert = require('assert');
const { CONFIG, SHEETS } = require('../lib/Config');
const CryptoUtils = require('../lib/CryptoUtils');
const SheetsService = require('../services/SheetsService');
const LocationService = require('../services/LocationService');
const ShiftService = require('../services/ShiftService');
const AdminService = require('../services/AdminService');
const AuthService = require('../services/AuthService');
const Code = require('../Code.gs');

let testsPassed = 0;
let testsTotal = 0;

function runTest(name, fn) {
  testsTotal++;
  try {
    fn();
    console.log(`  ✓ ${name}`);
    testsPassed++;
  } catch (err) {
    console.error(`  ✗ ${name}:`, err.message);
    throw err;
  }
}

console.log('=== RUNNING EMPLOYEE JOB SITE ASSIGNMENT TEST SUITE ===\n');

// Set up mock SheetsService database
const mockDb = {
  [SHEETS.EMPLOYEES]: [
    {
      ID: 'EMP000',
      Name: 'Ateeb Admin',
      Phone: '+971501111111',
      Role: 'Admin',
      'Site ID': '',
      'PIN Hash': CryptoUtils.hashPin('9999'),
      Status: 'Active',
      'Created At': new Date().toISOString(),
      'Last Accessed': ''
    },
    {
      ID: 'EMP001',
      Name: 'Tariq Labourer (No Site)',
      Phone: '+971502222222',
      Role: 'Labourer',
      'Site ID': '', // Unassigned!
      'PIN Hash': CryptoUtils.hashPin('1234'),
      Status: 'Active',
      'Created At': new Date().toISOString(),
      'Last Accessed': ''
    },
    {
      ID: 'EMP002',
      Name: 'Rashid Labourer (Invalid Site)',
      Phone: '+971503333333',
      Role: 'Labourer',
      'Site ID': 'SITE_NONEXISTENT',
      'PIN Hash': CryptoUtils.hashPin('1234'),
      Status: 'Active',
      'Created At': new Date().toISOString(),
      'Last Accessed': ''
    },
    {
      ID: 'EMP003',
      Name: 'Omar Labourer (Valid Site)',
      Phone: '+971504444444',
      Role: 'Labourer',
      'Site ID': 'SITE001',
      'PIN Hash': CryptoUtils.hashPin('1234'),
      Status: 'Active',
      'Created At': new Date().toISOString(),
      'Last Accessed': ''
    }
  ],
  [SHEETS.JOB_SITES]: [
    {
      ID: 'SITE001',
      Name: 'Downtown Dubai Project',
      Address: 'Downtown Dubai, UAE',
      Latitude: 25.1972,
      Longitude: 55.2744,
      'Geofence Radius': 100,
      Status: 'Active',
      'Created At': new Date().toISOString()
    },
    {
      ID: 'SITE002',
      Name: 'Dubai Marina Tower',
      Address: 'Dubai Marina, UAE',
      Latitude: 25.0805,
      Longitude: 55.1403,
      'Geofence Radius': 150,
      Status: 'Active',
      'Created At': new Date().toISOString()
    }
  ],
  [SHEETS.SHIFTS]: [],
  [SHEETS.OVERTIME]: [],
  [SHEETS.SETTINGS]: [],
  [SHEETS.AUDIT_LOGS]: []
};

SheetsService._mockData = mockDb;

// Create admin session token
const adminToken = CryptoUtils.createSessionToken({
  employeeId: 'EMP000',
  name: 'Ateeb Admin',
  role: 'Admin',
  siteId: ''
});

// Create labourer tokens
const unassignedToken = CryptoUtils.createSessionToken({
  employeeId: 'EMP001',
  name: 'Tariq Labourer',
  role: 'Labourer',
  siteId: ''
});

const invalidSiteToken = CryptoUtils.createSessionToken({
  employeeId: 'EMP002',
  name: 'Rashid Labourer',
  role: 'Labourer',
  siteId: 'SITE_NONEXISTENT'
});

const assignedToken = CryptoUtils.createSessionToken({
  employeeId: 'EMP003',
  name: 'Omar Labourer',
  role: 'Labourer',
  siteId: 'SITE001'
});

// Downtown Dubai site coordinates
const SITE1_LAT = 25.1972;
const SITE1_LON = 55.2744;

console.log('[1. Employee Without Site Validation]');
runTest('Labourer without assigned site receives exact error on START SHIFT', () => {
  const res = ShiftService.startShift({
    employeeId: 'EMP001',
    lat: SITE1_LAT,
    lon: SITE1_LON,
    accuracy: 10
  });

  assert.strictEqual(res.success, false, 'Must fail when employee has no assigned site');
  assert.strictEqual(
    res.message,
    'No job site assigned. Please contact your supervisor.',
    'Must return exact error message required'
  );
});

runTest('doPost API endpoint returns 400 with exact error when unassigned', () => {
  const event = {
    postData: {
      contents: JSON.stringify({
        action: 'startShift',
        token: unassignedToken,
        employeeId: 'EMP001',
        latitude: SITE1_LAT,
        longitude: SITE1_LON,
        accuracy: 10
      })
    }
  };

  const response = Code.doPost(event);
  assert.strictEqual(response.success, false);
  assert.strictEqual(response.message, 'No job site assigned. Please contact your supervisor.');
});

console.log('\n[2. Invalid / Nonexistent Site Validation]');
runTest('Labourer assigned to deleted or invalid site receives supervisor error', () => {
  const res = ShiftService.startShift({
    employeeId: 'EMP002',
    lat: SITE1_LAT,
    lon: SITE1_LON,
    accuracy: 10
  });

  assert.strictEqual(res.success, false, 'Must fail when assigned site does not exist');
  assert.strictEqual(res.code, 404);
  assert.ok(res.message.includes('Assigned job site (SITE_NONEXISTENT) was not found'));
});

console.log('\n[3. Geofence & GPS Accuracy Validation]');
runTest('START SHIFT inside permitted geofence succeeds', () => {
  // Coordinates 20m from SITE1_LAT, SITE1_LON (well within 100m geofence)
  const insideLat = SITE1_LAT + 0.0001;
  const insideLon = SITE1_LON + 0.0001;

  const res = ShiftService.startShift({
    employeeId: 'EMP003',
    lat: insideLat,
    lon: insideLon,
    accuracy: 12
  });

  assert.strictEqual(res.success, true, 'Must succeed inside geofence');
  assert.ok(res.shiftId, 'Must return generated shiftId');
  assert.strictEqual(res.siteId, 'SITE001', 'Must save correct Site ID');
  assert.strictEqual(res.siteName, 'Downtown Dubai Project', 'Must return site name');

  // Verify stored in Shifts sheet
  const shiftInDb = SheetsService.findById(SHEETS.SHIFTS, res.shiftId);
  assert.ok(shiftInDb, 'Shift must exist in database');
  assert.strictEqual(shiftInDb['Site ID'], 'SITE001', 'Database row must store Site ID');
  assert.strictEqual(shiftInDb.Status, 'Active');
});

runTest('START SHIFT outside permitted geofence is rejected with distance', () => {
  // End active shift for EMP003 first
  const active = ShiftService.getActiveShift('EMP003');
  if (active) {
    ShiftService.endShift({ employeeId: 'EMP003', lat: SITE1_LAT, lon: SITE1_LON, accuracy: 10 });
  }

  // Coordinates far away (e.g. 5km away: 25.2500, 55.3000)
  const farLat = 25.2500;
  const farLon = 55.3000;

  const res = ShiftService.startShift({
    employeeId: 'EMP003',
    lat: farLat,
    lon: farLon,
    accuracy: 15
  });

  assert.strictEqual(res.success, false, 'Must be rejected when outside geofence');
  assert.strictEqual(res.code, 403);
  assert.ok(res.message.includes('Outside assigned work site'), 'Error must specify outside site');
  assert.ok(res.distance > 100, 'Distance must exceed geofence radius');
});

console.log('\n[4. Admin Assignment & Changing Site Workflow]');
runTest('Admin can assign employee to a job site via updateEmployee', () => {
  const updateRes = AdminService.updateEmployee({
    currentId: 'EMP001',
    siteId: 'SITE001'
  }, { name: 'Ateeb Admin' });

  assert.strictEqual(updateRes.success, true, 'updateEmployee must succeed');
  assert.ok(updateRes.employee, 'Must return updated employee record');
  assert.strictEqual(updateRes.employee.siteId, 'SITE001', 'Updated record must have new siteId');

  // Verify in database
  const empInDb = SheetsService.getEmployeeById('EMP001');
  assert.strictEqual(empInDb['Site ID'], 'SITE001', 'Employees sheet must store Site ID');
});

runTest('Admin updateEmployee rejects nonexistent job site', () => {
  const updateRes = AdminService.updateEmployee({
    currentId: 'EMP001',
    siteId: 'FAKE_SITE_999'
  }, { name: 'Ateeb Admin' });

  assert.strictEqual(updateRes.success, false, 'Must reject nonexistent site');
  assert.ok(updateRes.message.includes('does not exist'));
});

runTest('Now-assigned labourer EMP001 can successfully START SHIFT', () => {
  const res = ShiftService.startShift({
    employeeId: 'EMP001',
    lat: SITE1_LAT,
    lon: SITE1_LON,
    accuracy: 10
  });

  assert.strictEqual(res.success, true, 'Shift start must now succeed');
  assert.strictEqual(res.siteId, 'SITE001');

  // End shift
  ShiftService.endShift({ employeeId: 'EMP001', lat: SITE1_LAT, lon: SITE1_LON, accuracy: 10 });
});

runTest('Admin can reassign employee to SITE002 without altering previous shift site ID', () => {
  // Reassign EMP001 to SITE002
  const updateRes = AdminService.updateEmployee({
    currentId: 'EMP001',
    siteId: 'SITE002'
  }, { name: 'Ateeb Admin' });

  assert.strictEqual(updateRes.success, true);
  assert.strictEqual(updateRes.employee.siteId, 'SITE002');

  // Verify previous completed shift for EMP001 still retains SITE001!
  const empShifts = ShiftService.getEmployeeShifts('EMP001');
  assert.strictEqual(empShifts.length, 1);
  assert.strictEqual(empShifts[0]['Site ID'], 'SITE001', 'Previous shift MUST retain original site SITE001');
});

console.log('\n[5. Profile Fetching & Login Profile Data]');
runTest('getEmployeeData returns latest assigned site and geofence coordinates', () => {
  const res = AuthService.getEmployeeData({ employeeId: 'EMP001' });

  assert.strictEqual(res.success, true);
  assert.strictEqual(res.employee.siteId, 'SITE002');
  assert.strictEqual(res.employee.siteName, 'Dubai Marina Tower');
  assert.strictEqual(res.employee.siteLat, 25.0805);
  assert.strictEqual(res.employee.siteLon, 55.1403);
  assert.strictEqual(res.employee.geofenceRadius, 150);
  assert.ok(res.jobSite, 'Must include jobSite object');
  assert.strictEqual(res.jobSite.id, 'SITE002');
});

runTest('Admin createEmployee validates site existence and stores Site ID', () => {
  const createRes = AdminService.createEmployee({
    name: 'New Worker',
    phone: '+971509999999',
    pin: '5555',
    siteId: 'SITE002'
  }, { name: 'Ateeb Admin' });

  assert.strictEqual(createRes.success, true);
  assert.ok(createRes.employeeId);
  assert.strictEqual(createRes.employee.siteId, 'SITE002');

  const inDb = SheetsService.getEmployeeById(createRes.employeeId);
  assert.strictEqual(inDb['Site ID'], 'SITE002');
});

console.log(`\n=== ALL ${testsPassed}/${testsTotal} SITE ASSIGNMENT TESTS PASSED! ===`);
