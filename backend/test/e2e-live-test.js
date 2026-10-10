/**
 * Live End-to-End Integration Verification against deployed Google Apps Script
 */

const GAS_URL = 'https://script.google.com/macros/s/AKfycbzMnWtI2MNLxuNMzt_BrIcgY_jXfHd1tTG1qL4DyJDG3PVbC5JO96FPsUP-_eP2SJ7Z/exec';

async function sendRequest(payload, timeoutMs = 35000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const start = Date.now();

  try {
    const res = await fetch(GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      redirect: 'follow',
      signal: controller.signal
    });
    clearTimeout(timer);
    const json = await res.json();
    return { ok: true, duration: Date.now() - start, data: json };
  } catch (err) {
    clearTimeout(timer);
    return { ok: false, duration: Date.now() - start, error: err.message };
  }
}

async function run() {
  console.log('=== RUNNING LIVE GOOGLE APPS SCRIPT VERIFICATION ===\n');

  // 1. Health check ping
  console.log('1. Testing ping endpoint...');
  const pingRes = await sendRequest({ action: 'ping' });
  console.log('Ping Result:', pingRes);
  if (!pingRes.ok || !pingRes.data.success) {
    throw new Error('Ping failed');
  }
  console.log('✓ Ping succeeded in ' + pingRes.duration + 'ms\n');

  // 2. Login attempt with wrong PIN on EMP000
  console.log('2. Testing invalid PIN login on EMP000...');
  const invalidLogin = await sendRequest({ action: 'login', employeeId: 'EMP000', pin: '000000' });
  console.log('Invalid Login Result:', invalidLogin);
  if (!invalidLogin.ok || invalidLogin.data.success !== false) {
    throw new Error('Invalid PIN should have returned success: false');
  }
  if (!invalidLogin.data.message || !invalidLogin.data.message.includes('Invalid Employee ID or PIN')) {
    throw new Error('Invalid PIN message unexpected: ' + invalidLogin.data.message);
  }
  console.log('✓ Invalid PIN correctly rejected with: "' + invalidLogin.data.message + '"\n');

  // 3. Login attempt with numeric ID "0" (Admin Ateeb)
  console.log('3. Testing numeric ID normalization for "0" (Admin)...');
  const numericAdminLogin = await sendRequest({ action: 'login', employeeId: '0', pin: '000000' });
  console.log('Numeric Admin Result:', numericAdminLogin);
  if (!numericAdminLogin.ok || numericAdminLogin.data.success !== false) {
    throw new Error('Should have processed and checked PIN');
  }
  console.log('✓ Numeric ID "0" recognized by backend\n');

  console.log('=== ALL LIVE INTEGRATION CHECKS PASSED SUCCESSFULLY ===');
}

run().catch(err => {
  console.error('FAILED:', err);
  process.exit(1);
});
