/**
 * Cloudflare Worker R2 Photo Storage & Access Control Test Suite
 */

const assert = require('assert');
const CryptoUtils = require('../lib/CryptoUtils');

let workerModule;
try {
  // worker.js uses ES module export
  // We can test the fetch handler via dynamic import or by creating a mock test
} catch (e) {
  // handled below
}

let testsPassed = 0;
let testsTotal = 0;

function runTest(name, fn) {
  testsTotal++;
  try {
    fn();
    console.log(`  ✓ ${name}`);
    testsPassed++;
  } catch (err) {
    console.error(`  ✗ ${name}: ${err.message}`);
    throw err;
  }
}

async function runAsyncTest(name, fn) {
  testsTotal++;
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    testsPassed++;
  } catch (err) {
    console.error(`  ✗ ${name}: ${err.message}`);
    throw err;
  }
}

async function run() {
  console.log('=== RUNNING CLOUDFLARE R2 PHOTO STORAGE & SECURITY TEST SUITE ===\n');

  // Load worker.js
  const worker = (await import('../../worker.js')).default;

  // Generate real session tokens using CryptoUtils
  const labourerToken = CryptoUtils.createSessionToken({
    employeeId: 'EMP001',
    name: 'Ahmed Labourer',
    role: 'Labourer',
    siteId: 'SITE001'
  });

  const otherLabourerToken = CryptoUtils.createSessionToken({
    employeeId: 'EMP002',
    name: 'Rashid Worker',
    role: 'Labourer',
    siteId: 'SITE001'
  });

  const adminToken = CryptoUtils.createSessionToken({
    employeeId: 'EMP000',
    name: 'Ateeb Admin',
    role: 'Admin',
    siteId: ''
  });

  // Mock sample 1x1 pixel base64 JPEG
  const sampleJpegBase64 = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';

  // Mock Cloudflare R2 bucket
  const mockBucketStorage = new Map();
  const mockEnv = {
    PHOTOS_BUCKET: {
      async put(key, bytes, options) {
        mockBucketStorage.set(key, { bytes, options });
        return { key };
      },
      async get(key) {
        const item = mockBucketStorage.get(key);
        if (!item) return null;
        return {
          body: item.bytes,
          httpMetadata: item.options.httpMetadata,
          customMetadata: item.options.customMetadata,
          httpEtag: '"mock-etag-123"',
          writeHttpMetadata(headers) {
            headers.set('Content-Type', item.options.httpMetadata.contentType);
          }
        };
      }
    }
  };

  console.log('[1. Photo Upload Authentication & Authorization]');

  await runAsyncTest('Upload without session token is rejected with 401', async () => {
    const req = new Request('https://overtime-tracker.exp-tracker.workers.dev/api/photos/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64: sampleJpegBase64, employeeId: 'EMP001', type: 'start' })
    });
    const res = await worker.fetch(req, mockEnv);
    assert.strictEqual(res.status, 401);
    const data = await res.json();
    assert.strictEqual(data.success, false);
    assert.ok(data.message.includes('Valid session token is required'));
  });

  await runAsyncTest('Labourer uploading for another employee is forbidden with 403', async () => {
    const req = new Request('https://overtime-tracker.exp-tracker.workers.dev/api/photos/upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${otherLabourerToken}`
      },
      body: JSON.stringify({ imageBase64: sampleJpegBase64, employeeId: 'EMP001', type: 'start' })
    });
    const res = await worker.fetch(req, mockEnv);
    assert.strictEqual(res.status, 403);
    const data = await res.json();
    assert.strictEqual(data.success, false);
    assert.ok(data.message.includes('cannot upload an attendance selfie for another employee'));
  });

  await runAsyncTest('Upload with invalid image MIME type is rejected', async () => {
    const req = new Request('https://overtime-tracker.exp-tracker.workers.dev/api/photos/upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${labourerToken}`
      },
      body: JSON.stringify({
        imageBase64: 'data:text/plain;base64,SGVsbG8gd29ybGQ=',
        employeeId: 'EMP001',
        type: 'start'
      })
    });
    const res = await worker.fetch(req, mockEnv);
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.strictEqual(data.success, false);
    assert.ok(data.message.includes('Invalid image format'));
  });

  let uploadedPhotoKey = null;

  await runAsyncTest('Valid labourer selfie upload succeeds and saves to R2 bucket', async () => {
    const req = new Request('https://overtime-tracker.exp-tracker.workers.dev/api/photos/upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${labourerToken}`
      },
      body: JSON.stringify({
        imageBase64: sampleJpegBase64,
        employeeId: 'EMP001',
        type: 'start',
        capturedAt: '2026-10-15T08:00:00.000Z'
      })
    });
    const res = await worker.fetch(req, mockEnv);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.ok(data.photoKey.startsWith('photos/EMP001/'), 'Must start with photos/EMP001/, got: ' + data.photoKey);
    assert.ok(data.photoKey.includes('/start_'));
    uploadedPhotoKey = data.photoKey;

    // Verify item in R2 bucket
    assert.ok(mockBucketStorage.has(uploadedPhotoKey), 'Photo must be saved in R2 bucket');
  });

  console.log('\n[2. Photo Access Control & Secure Retrieval]');

  await runAsyncTest('Photo view without token is rejected with 401', async () => {
    const req = new Request(`https://overtime-tracker.exp-tracker.workers.dev/api/photos/view?key=${uploadedPhotoKey}`);
    const res = await worker.fetch(req, mockEnv);
    assert.strictEqual(res.status, 401);
  });

  await runAsyncTest('Unrelated labourer viewing another labourer photo is forbidden with 403', async () => {
    const req = new Request(`https://overtime-tracker.exp-tracker.workers.dev/api/photos/view?key=${uploadedPhotoKey}&token=${otherLabourerToken}`);
    const res = await worker.fetch(req, mockEnv);
    assert.strictEqual(res.status, 403);
  });

  await runAsyncTest('Owner labourer can view their own photo', async () => {
    const req = new Request(`https://overtime-tracker.exp-tracker.workers.dev/api/photos/view?key=${uploadedPhotoKey}&token=${labourerToken}`);
    const res = await worker.fetch(req, mockEnv);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('Content-Type'), 'image/jpeg');
    assert.strictEqual(res.headers.get('Cache-Control'), 'private, max-age=300');
  });

  await runAsyncTest('Admin Ateeb can view any employee photo for attendance verification', async () => {
    const req = new Request(`https://overtime-tracker.exp-tracker.workers.dev/api/photos/view?key=${uploadedPhotoKey}&token=${adminToken}`);
    const res = await worker.fetch(req, mockEnv);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('Content-Type'), 'image/jpeg');
  });

  await runAsyncTest('Requesting nonexistent photo returns 404', async () => {
    const req = new Request(`https://overtime-tracker.exp-tracker.workers.dev/api/photos/view?key=photos/EMP001/nonexistent.jpg&token=${adminToken}`);
    const res = await worker.fetch(req, mockEnv);
    assert.strictEqual(res.status, 404);
  });

  console.log(`\n=== ALL ${testsPassed}/${testsTotal} PHOTO STORAGE & SECURITY TESTS PASSED! ===\n`);
}

run().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});

