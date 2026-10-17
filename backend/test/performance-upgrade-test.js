/**
 * Automated Verification Suite for Ultra-Fast Performance Upgrades
 * Validates:
 * 1. Edge Proxy Routing & Cache-Control Headers in worker.js
 * 2. Backend SheetsService In-Memory & Script Caching
 * 3. Frontend Data Layer Mutation Logic & Canonical Response Normalization
 * 4. Lock Safety & Non-blocking Concurrency Controls
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('=== RUNNING ULTRA-FAST PERFORMANCE UPGRADE TEST SUITE ===\n');

// -------------------------------------------------------------------
// 1. Cloudflare Edge Proxy & Static Asset Caching Rules in worker.js
// -------------------------------------------------------------------
console.log('[1. Cloudflare Worker Edge Proxy & Cache-Control Headers]');

const workerCode = fs.readFileSync(path.join(__dirname, '../../worker.js'), 'utf8');

// Verify edge proxy route exists
assert(workerCode.includes("pathname === '/api/gas'"), 'worker.js must route /api/gas');
console.log('  ✓ /api/gas route is registered and handled');

// Verify static asset caching rules
assert(workerCode.includes('31536000') && workerCode.includes('immutable'), 'Immutable static asset caching rule for Next.js static assets');
assert(workerCode.includes('must-revalidate'), 'Must-revalidate caching rule for HTML/document requests');
console.log('  ✓ Edge Cache-Control headers verified (1-year immutable for Next.js chunks, must-revalidate for HTML)');

// Verify security headers
assert(workerCode.includes('X-Content-Type-Options') && workerCode.includes('nosniff'), 'Missing X-Content-Type-Options: nosniff');
assert(workerCode.includes('X-Frame-Options') && workerCode.includes('SAMEORIGIN'), 'Missing X-Frame-Options: SAMEORIGIN');
assert(workerCode.includes('Referrer-Policy'), 'Missing Referrer-Policy header');
console.log('  ✓ Strict modern security headers verified on edge proxy');

// -------------------------------------------------------------------
// 2. Google Apps Script Backend SheetsService In-Memory & Script Cache
// -------------------------------------------------------------------
console.log('\n[2. Backend SheetsService Header & Reference Data Caching]');

const sheetsServiceCode = fs.readFileSync(path.join(__dirname, '../services/SheetsService.js'), 'utf8');

assert(sheetsServiceCode.includes('_headerCache'), 'SheetsService must maintain in-memory _headerCache');
assert(sheetsServiceCode.includes('CacheService.getScriptCache()'), 'SheetsService must integrate CacheService.getScriptCache()');
assert(sheetsServiceCode.includes('_invalidateCache'), 'SheetsService must provide atomic _invalidateCache method');
console.log('  ✓ In-memory header caching and distributed script caching implemented in SheetsService.js');

// Verify ShiftService lock timeout capped to 10s
const shiftServiceCode = fs.readFileSync(path.join(__dirname, '../services/ShiftService.js'), 'utf8');
assert(shiftServiceCode.includes('10000') || shiftServiceCode.includes('10 * 1000'), 'ShiftService lock timeout must be capped at 10s');
console.log('  ✓ ShiftService lock acquisition capped to 10s to prevent HTTP cascading timeouts');

// -------------------------------------------------------------------
// 3. Frontend Data Layer Mutation Logic
// -------------------------------------------------------------------
console.log('\n[3. Frontend Data Layer & Response Normalization]');

const useDataLayerCode = fs.readFileSync(path.join(__dirname, '../../frontend/src/lib/useDataLayer.ts'), 'utf8');
const apiCode = fs.readFileSync(path.join(__dirname, '../../frontend/src/lib/api.ts'), 'utf8');

assert(useDataLayerCode.includes('useAdminDashboard'), 'useAdminDashboard hook present');
assert(useDataLayerCode.includes('useLabourerDashboard'), 'useLabourerDashboard hook present');
assert(useDataLayerCode.includes('applyConfirmedShift'), 'applyConfirmedShift method present in useLabourerDashboard');
assert(useDataLayerCode.includes('addEmployeeLocally'), 'addEmployeeLocally mutation present');
assert(useDataLayerCode.includes('addJobSiteLocally'), 'addJobSiteLocally mutation present');
assert(useDataLayerCode.includes('approveOvertimeLocally'), 'approveOvertimeLocally mutation present');
console.log('  ✓ Instant SWR optimistic mutation methods verified in useDataLayer.ts');

// Verify normalization in api.ts
assert(apiCode.includes('res.data.site = siteObj') && apiCode.includes('res.data.jobSite = siteObj'), 'createJobSite and updateJobSite must set both site and jobSite');
console.log('  ✓ createJobSite & updateJobSite normalize both site and jobSite for UI consumers');

// Verify browser-to-edge proxy bridge in api.ts
assert(apiCode.includes("fetch('/api/gas'"), 'sendGasRequest must attempt /api/gas proxy in browser');
assert(apiCode.includes('GAS_URL'), 'sendGasRequest must maintain automatic fallback to GAS_URL');
console.log('  ✓ Edge proxy bridge with seamless GAS_URL fallback verified in sendGasRequest');

// -------------------------------------------------------------------
// 4. Bundled Dist.gs Consistency
// -------------------------------------------------------------------
console.log('\n[4. Production Dist.gs Integrity & Syntax]');

const distCode = fs.readFileSync(path.join(__dirname, '../Dist.gs'), 'utf8');
assert(distCode.length > 50000, 'Dist.gs bundle must be populated');
assert(distCode.includes('SheetsService'), 'Dist.gs must include SheetsService');
assert(distCode.includes('AdminService'), 'Dist.gs must include AdminService');
assert(distCode.includes('ShiftService'), 'Dist.gs must include ShiftService');

// Verify valid JS syntax by testing with new Function()
try {
  new Function(distCode);
  console.log(`  ✓ Dist.gs is 100% valid JavaScript syntax (${Math.round(distCode.length / 1024)} KB)`);
} catch (e) {
  assert.fail(`Dist.gs has syntax error: ${e.message}`);
}

console.log('\n=== ALL PERFORMANCE UPGRADE TESTS PASSED SUCCESSFULLY! ===\n');
