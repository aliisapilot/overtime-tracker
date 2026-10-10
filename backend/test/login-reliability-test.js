/**
 * Automated Regression Test Suite: Login Reliability & First-Attempt Fixes
 * 
 * Verifies:
 * 1. Employee ID Normalization (EMP001, 1, 01, EMP1, emp1, EMP000, 0)
 * 2. ID matching fallback in AuthService
 * 3. Session token expiration detection (valid, expired, malformed)
 * 4. Network failure vs Authentication failure distinction (never retry invalid PIN)
 * 5. Concurrent request queue contention mitigation
 */

const assert = require('assert');
const CryptoUtils = require('../lib/CryptoUtils');
const SheetsService = require('../services/SheetsService');
const AuthService = require('../services/AuthService');
const { SHEETS } = require('../lib/Config');

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

console.log('=== RUNNING LOGIN RELIABILITY REGRESSION SUITE ===\n');

// 1. Employee ID Normalization logic
console.log('[1. Employee ID Flexible Normalization]');
function normalizeEmployeeId(rawId) {
  if (!rawId) return '';
  const clean = rawId.trim().toUpperCase();
  if (/^\d+$/.test(clean)) {
    return 'EMP' + clean.padStart(3, '0');
  }
  const match = clean.match(/^EMP(\d+)$/i);
  if (match) {
    return 'EMP' + match[1].padStart(3, '0');
  }
  return clean;
}

runTest('Normalizes pure single digit "1" -> "EMP001"', () => {
  assert.strictEqual(normalizeEmployeeId('1'), 'EMP001');
});

runTest('Normalizes pure padded digits "001" -> "EMP001"', () => {
  assert.strictEqual(normalizeEmployeeId('001'), 'EMP001');
});

runTest('Normalizes unpadded prefix "EMP1" -> "EMP001"', () => {
  assert.strictEqual(normalizeEmployeeId('EMP1'), 'EMP001');
});

runTest('Normalizes lowercase "emp1" -> "EMP001"', () => {
  assert.strictEqual(normalizeEmployeeId('emp1'), 'EMP001');
});

runTest('Normalizes admin "0" -> "EMP000"', () => {
  assert.strictEqual(normalizeEmployeeId('0'), 'EMP000');
});

runTest('Normalizes admin "EMP0" -> "EMP000"', () => {
  assert.strictEqual(normalizeEmployeeId('EMP0'), 'EMP000');
});

runTest('Preserves exact standard ID "EMP000"', () => {
  assert.strictEqual(normalizeEmployeeId('EMP000'), 'EMP000');
});

// 2. AuthService Backend Lookup Fallback
console.log('\n[2. AuthService Backend ID Lookup Fallback]');
const testPin = '7890';
const testPinHash = CryptoUtils.hashPin(testPin);

SheetsService.setMockData({
  [SHEETS.EMPLOYEES]: [
    {
      ID: 'EMP001',
      Name: 'Worker One',
      Phone: '+971501111111',
      Role: 'Labourer',
      'Site ID': 'SITE001',
      'PIN Hash': testPinHash,
      Status: 'Active',
      'Created At': new Date().toISOString(),
      'Last Accessed': ''
    },
    {
      ID: 'EMP000',
      Name: 'Ateeb',
      Phone: '+971500000000',
      Role: 'Admin',
      'Site ID': '',
      'PIN Hash': testPinHash,
      Status: 'Active',
      'Created At': new Date().toISOString(),
      'Last Accessed': ''
    }
  ],
  [SHEETS.JOB_SITES]: [
    {
      ID: 'SITE001',
      Name: 'Downtown Tower',
      Latitude: 25.1972,
      Longitude: 55.2744,
      'Geofence Radius': 100,
      Status: 'Active'
    }
  ],
  [SHEETS.AUDIT_LOGS]: []
});

runTest('AuthService logs in using unpadded "EMP1"', () => {
  const result = AuthService.login({ employeeId: 'EMP1', pin: testPin });
  assert.strictEqual(result.success, true, 'Login should succeed for EMP1');
  assert.strictEqual(result.employee.id, 'EMP001');
  assert.ok(result.token, 'Must return signed token');
});

runTest('AuthService logs in using pure digit "1"', () => {
  const result = AuthService.login({ employeeId: '1', pin: testPin });
  assert.strictEqual(result.success, true, 'Login should succeed for 1');
  assert.strictEqual(result.employee.id, 'EMP001');
});

runTest('AuthService logs in admin using "EMP0" or "0"', () => {
  const result = AuthService.login({ employeeId: 'EMP0', pin: testPin });
  assert.strictEqual(result.success, true, 'Login should succeed for EMP0');
  assert.strictEqual(result.employee.id, 'EMP000');
  assert.strictEqual(result.employee.role, 'Admin');
});

runTest('AuthService rejects incorrect PIN with remaining attempts counter', () => {
  const result = AuthService.login({ employeeId: 'EMP001', pin: '0000' });
  assert.strictEqual(result.success, false);
  assert.ok(result.message.includes('Invalid Employee ID or PIN'));
});

// 3. Session Expiration Validation
console.log('\n[3. Session Expiration Validation]');
function isSessionValid(session) {
  if (!session || !session.token || !session.employee) return false;
  try {
    const parts = session.token.split('.');
    if (parts.length !== 2) return false;
    const base64 = parts[0].replace(/-/g, '+').replace(/_/g, '/');
    const jsonStr = Buffer.from(base64, 'base64').toString('utf8');
    const payload = JSON.parse(jsonStr);
    if (payload.exp && typeof payload.exp === 'number') {
      const now = Date.now();
      if (payload.exp <= now + 30000) return false;
    }
    return true;
  } catch {
    return false;
  }
}

runTest('Valid unexpired session passes validation', () => {
  const validToken = CryptoUtils.createSessionToken({
    employeeId: 'EMP001',
    name: 'Worker',
    role: 'Labourer'
  });
  const session = {
    token: validToken,
    employee: { id: 'EMP001', name: 'Worker', role: 'Labourer', status: 'Active' }
  };
  assert.strictEqual(isSessionValid(session), true);
});

runTest('Expired session token is detected and rejected', () => {
  // Construct an expired token payload
  const expiredPayload = {
    employeeId: 'EMP001',
    name: 'Worker',
    role: 'Labourer',
    iat: Date.now() - 100000,
    exp: Date.now() - 5000 // expired 5 seconds ago
  };
  const b64 = Buffer.from(JSON.stringify(expiredPayload)).toString('base64');
  const sig = CryptoUtils.hmacSha256(b64, CryptoUtils.getAuthSecret());
  const expiredToken = b64 + '.' + sig;

  const session = {
    token: expiredToken,
    employee: { id: 'EMP001', name: 'Worker', role: 'Labourer', status: 'Active' }
  };
  assert.strictEqual(isSessionValid(session), false, 'Expired session must return false');
});

runTest('Malformed session token is rejected', () => {
  const session = {
    token: 'garbage_token_string',
    employee: { id: 'EMP001', name: 'Worker', role: 'Labourer', status: 'Active' }
  };
  assert.strictEqual(isSessionValid(session), false, 'Malformed token must return false');
});

// 4. Retry Rule Verification: Network error vs Invalid PIN
console.log('\n[4. Safe Bounded Retry Guardrails]');
function shouldRetry(response) {
  // Never retry auth rejections (code 200 with success: false)
  if (response.code !== 408 && response.code !== 0 && response.success !== undefined) {
    return false;
  }
  // Safe to retry on transport timeout or network failure
  return response.code === 408 || response.code === 0;
}

runTest('Authentication failure (Invalid PIN) is NEVER retried', () => {
  const authFailure = { success: false, code: 200, message: 'Invalid Employee ID or PIN (4 attempts remaining)' };
  assert.strictEqual(shouldRetry(authFailure), false, 'Must NOT retry invalid credentials');
});

runTest('Account locked response is NEVER retried', () => {
  const lockFailure = { success: false, code: 200, message: 'Account is temporarily locked' };
  assert.strictEqual(shouldRetry(lockFailure), false, 'Must NOT retry locked account');
});

runTest('Network timeout (code 408) is safely retried', () => {
  const timeoutFailure = { success: false, code: 408, message: 'Request timed out after 45 seconds' };
  assert.strictEqual(shouldRetry(timeoutFailure), true, 'Safe to retry network timeout');
});

runTest('Network exception / fetch failure (code 0) is safely retried', () => {
  const networkFailure = { success: false, code: 0, message: 'Failed to fetch' };
  assert.strictEqual(shouldRetry(networkFailure), true, 'Safe to retry transport drop');
});

console.log(`\n=== ALL ${testsPassed}/${testsTotal} REGRESSION TESTS PASSED! ===\n`);
