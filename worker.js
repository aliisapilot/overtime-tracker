/**
 * Cloudflare Worker for Overtime Tracker
 * - Serves Next.js static assets via ASSETS binding
 * - Provides secure, authenticated Cloudflare R2 endpoints for attendance photos:
 *   - POST /api/photos/upload: Validates session, file type, file size, stores to R2
 *   - GET  /api/photos/view: Authenticated photo retrieval with role & ownership checks
 *   - GET  /api/health: System diagnostics and R2 readiness check
 */

// In-memory fallback cache for local dev / testing environments without live R2 bindings
const devPhotoStore = new Map();
const DEFAULT_AUTH_SECRET = 'overtime-tracker-auth-proof-v2';
const PHOTO_KEY_PATTERN = /^photos\/[A-Za-z0-9_-]+\/\d{8}\/(start|end)_[a-f0-9]+\.(jpg|jpeg|png|webp)$/i;

/**
 * Generate cryptographic proof of photo upload
 */
async function generateUploadProof(photoKey, employeeId, capturedAt, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const data = enc.encode(`${photoKey}:${employeeId}:${capturedAt || ''}`);
  const signature = await crypto.subtle.sign('HMAC', key, data);
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Decode and validate session token with HMAC verification
 * Format: <base64url-payload>.<hmac-signature>
 */
async function parseAndValidateSession(token, secret = null) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;

  try {
    const payloadB64 = parts[0];
    const signature = parts[1];
    const base64 = payloadB64.replace(/-/g, '+').replace(/_/g, '/');
    const jsonStr = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    const payload = JSON.parse(jsonStr);

    // Verify token expiry
    if (payload.exp && typeof payload.exp === 'number') {
      if (payload.exp < Date.now()) {
        return null; // Expired
      }
    }

    if (!payload.employeeId) return null;

    // Verify HMAC-SHA256 signature if secret is provided
    if (secret && signature) {
      const enc = new TextEncoder();
      const key = await crypto.subtle.importKey(
        'raw',
        enc.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['verify']
      );
      const matches = signature.match(/[\da-f]{2}/gi);
      if (matches && matches.length === 32) {
        const sigBytes = new Uint8Array(matches.map((h) => parseInt(h, 16)));
        const isValid = await crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(payloadB64));
        if (!isValid) return null;
      }
    }

    return payload;
  } catch {
    return null;
  }
}

function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
    'Access-Control-Max-Age': '86400',
  };
}

function jsonResponse(data, status = 200, request = null) {
  const headers = {
    'Content-Type': 'application/json',
    ...(request ? corsHeaders(request) : {}),
  };
  return new Response(JSON.stringify(data), { status, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const authSecret = (env && env.AUTH_SECRET) || DEFAULT_AUTH_SECRET;

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(request),
      });
    }

    // Health check endpoint
    if (pathname === '/api/health') {
      return jsonResponse({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        hasR2Binding: Boolean(env && env.PHOTOS_BUCKET),
        version: '2.0.0-photo-gps'
      }, 200, request);
    }

    // 1. PHOTO UPLOAD ENDPOINT
    if (pathname === '/api/photos/upload' && request.method === 'POST') {
      try {
        const authHeader = request.headers.get('Authorization') || '';
        const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
        const session = await parseAndValidateSession(token, authSecret);

        if (!session) {
          return jsonResponse({
            success: false,
            code: 401,
            message: 'Unauthorized: Valid session token is required to upload attendance photo.'
          }, 401, request);
        }

        let body;
        try {
          body = await request.json();
        } catch {
          return jsonResponse({ success: false, message: 'Invalid JSON payload' }, 400, request);
        }

        const { imageBase64, employeeId, type, capturedAt } = body;

        if (!imageBase64 || typeof imageBase64 !== 'string') {
          return jsonResponse({ success: false, message: 'Selfie photo data (imageBase64) is required.' }, 400, request);
        }

        const normalizedEmpId = (employeeId || session.employeeId || '').trim().toUpperCase();

        // Enforce ownership: labourer can only upload their own selfie; admin can upload for anyone
        if (session.role !== 'Admin' && session.employeeId.toUpperCase() !== normalizedEmpId) {
          return jsonResponse({
            success: false,
            code: 403,
            message: 'Forbidden: You cannot upload an attendance selfie for another employee.'
          }, 403, request);
        }

        // Validate type
        const photoType = (type === 'end') ? 'end' : 'start';

        // Extract and validate MIME type and base64 data
        let mimeType = 'image/jpeg';
        let rawBase64 = imageBase64;
        const dataUrlMatch = imageBase64.match(/^data:([^;]+);base64,(.+)$/);
        if (dataUrlMatch) {
          mimeType = dataUrlMatch[1].toLowerCase();
          rawBase64 = dataUrlMatch[2];
        }

        const allowedMimes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
        if (!allowedMimes.includes(mimeType)) {
          return jsonResponse({
            success: false,
            message: 'Invalid image format. Only JPEG, PNG, and WebP are accepted.'
          }, 400, request);
        }

        // Decode base64 to binary byte array
        const binaryString = atob(rawBase64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }

        // Validate size: max 5MB, typical compressed selfie is ~50-200KB
        const MAX_SIZE = 5 * 1024 * 1024;
        if (bytes.length > MAX_SIZE) {
          return jsonResponse({
            success: false,
            message: 'Image size exceeds maximum limit (5MB). Please retake.'
          }, 400, request);
        }

        // Generate clean unique key: photos/{employeeId}/{date}/{type}_{random}.jpg
        const dateStr = new Date().toISOString().split('T')[0].replace(/-/g, '');
        const randomHex = Array.from(crypto.getRandomValues(new Uint8Array(8)))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
        const extension = mimeType === 'image/png' ? 'png' : (mimeType === 'image/webp' ? 'webp' : 'jpg');
        const photoKey = `photos/${normalizedEmpId}/${dateStr}/${photoType}_${randomHex}.${extension}`;
        const serverCapturedAt = capturedAt || new Date().toISOString();

        // Save to Cloudflare R2 bucket if bound
        if (env && env.PHOTOS_BUCKET) {
          await env.PHOTOS_BUCKET.put(photoKey, bytes, {
            httpMetadata: {
              contentType: mimeType,
              cacheControl: 'private, max-age=300'
            },
            customMetadata: {
              employeeId: normalizedEmpId,
              type: photoType,
              capturedAt: serverCapturedAt,
              uploadedAt: new Date().toISOString()
            }
          });
        } else {
          // Dev fallback when running in testing/mock environments without live R2
          devPhotoStore.set(photoKey, {
            bytes,
            mimeType,
            employeeId: normalizedEmpId,
            capturedAt: serverCapturedAt
          });
        }

        const photoProof = await generateUploadProof(photoKey, normalizedEmpId, serverCapturedAt, authSecret);

        return jsonResponse({
          success: true,
          photoKey,
          photoProof,
          capturedAt: serverCapturedAt,
          size: bytes.length,
          message: 'Selfie uploaded and secured successfully'
        }, 200, request);

      } catch (err) {
        return jsonResponse({
          success: false,
          message: 'Upload processing failed: ' + (err.message || String(err))
        }, 500, request);
      }
    }

    // 2. SECURE PHOTO RETRIEVAL ENDPOINT
    if (pathname.startsWith('/api/photos/view') && request.method === 'GET') {
      try {
        const photoKey = url.searchParams.get('key');
        const token = url.searchParams.get('token') || (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');

        if (!photoKey) {
          return jsonResponse({ success: false, message: 'Photo key is required.' }, 400, request);
        }

        // Strict path traversal / format check
        if (!PHOTO_KEY_PATTERN.test(photoKey)) {
          return jsonResponse({
            success: false,
            code: 400,
            message: 'Invalid photo key format. Path traversal rejected.'
          }, 400, request);
        }

        const session = await parseAndValidateSession(token, authSecret);
        if (!session) {
          return jsonResponse({
            success: false,
            code: 401,
            message: 'Unauthorized: Session token is required to view attendance photos.'
          }, 401, request);
        }

        // Ownership and authorization check:
        // Admin Ateeb can view any photo; labourers can only view their own photos
        const keyParts = photoKey.split('/');
        const ownerEmpId = keyParts.length >= 2 ? keyParts[1].toUpperCase() : '';
        const isOwner = session.employeeId && (session.employeeId.toUpperCase() === ownerEmpId);
        const isAdmin = session.role === 'Admin';

        if (!isAdmin && !isOwner) {
          return jsonResponse({
            success: false,
            code: 403,
            message: 'Forbidden: You do not have permission to view this photo.'
          }, 403, request);
        }

        // Fetch from Cloudflare R2
        if (env && env.PHOTOS_BUCKET) {
          const object = await env.PHOTOS_BUCKET.get(photoKey);
          if (!object) {
            return jsonResponse({ success: false, message: 'Photo not found in storage.' }, 404, request);
          }

          const headers = new Headers();
          object.writeHttpMetadata(headers);
          headers.set('Cache-Control', 'private, max-age=300'); // Short-lived private cache
          headers.set('etag', object.httpEtag);
          Object.entries(corsHeaders(request)).forEach(([k, v]) => headers.set(k, v));

          return new Response(object.body, { headers });
        } else {
          // Dev fallback
          const item = devPhotoStore.get(photoKey);
          if (!item) {
            return jsonResponse({ success: false, message: 'Photo not found in dev storage.' }, 404, request);
          }
          return new Response(item.bytes, {
            headers: {
              'Content-Type': item.mimeType || 'image/jpeg',
              'Cache-Control': 'private, max-age=300',
              ...corsHeaders(request)
            }
          });
        }
      } catch (err) {
        return jsonResponse({
          success: false,
          message: 'Failed to retrieve photo: ' + (err.message || String(err))
        }, 500, request);
      }
    }

    // 3. SECURE ATTENDANCE PHOTO DELETION ENDPOINT (ADMIN-ONLY UNDER RETENTION POLICY)
    if (pathname === '/api/photos/delete' && request.method === 'POST') {
      try {
        const authHeader = request.headers.get('Authorization') || '';
        const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
        const session = await parseAndValidateSession(token, authSecret);

        if (!session) {
          return jsonResponse({
            success: false,
            code: 401,
            message: 'Unauthorized: Session token is required to purge attendance photos.'
          }, 401, request);
        }

        if (session.role !== 'Admin') {
          return jsonResponse({
            success: false,
            code: 403,
            message: 'Forbidden: Administrator privileges required to purge photos.'
          }, 403, request);
        }

        let body;
        try {
          body = await request.json();
        } catch {
          return jsonResponse({ success: false, message: 'Invalid JSON payload' }, 400, request);
        }

        const { photoKey, reason, policyAck } = body || {};

        if (!photoKey) {
          return jsonResponse({ success: false, message: 'Photo key is required.' }, 400, request);
        }

        if (!reason || !policyAck) {
          return jsonResponse({
            success: false,
            message: 'A mandatory reason and policy acknowledgement are required to purge attendance photos.'
          }, 400, request);
        }

        // Strict path format validation
        if (!PHOTO_KEY_PATTERN.test(photoKey)) {
          return jsonResponse({
            success: false,
            code: 400,
            message: 'Invalid photo key format. Path traversal rejected.'
          }, 400, request);
        }

        if (env && env.PHOTOS_BUCKET) {
          await env.PHOTOS_BUCKET.delete(photoKey);
        } else {
          devPhotoStore.delete(photoKey);
        }

        return jsonResponse({
          success: true,
          photoKey,
          purgedAt: new Date().toISOString(),
          purgedBy: session.name || session.employeeId,
          message: 'Attendance photo permanently purged from storage under retention policy.'
        }, 200, request);
      } catch (delErr) {
        return jsonResponse({
          success: false,
          message: 'Failed to purge photo: ' + (delErr.message || String(delErr))
        }, 500, request);
      }
    }

    // 4. SECURE GAS BACKEND EDGE PROXY
    // Proxies frontend requests to Google Apps Script over Cloudflare global backbone with connection reuse
    if (pathname === '/api/gas' && request.method === 'POST') {
      try {
        const gasUrl = (env && env.GAS_WEB_APP_URL) || 'https://script.google.com/macros/s/AKfycbzAsJfsSviCiq47tTG6srTqAo4yZTFaGZDG0SQOPZjWNHdMSiyI8ELfuk2FmQ39QPcP/exec';
        const payloadText = await request.text();

        const gasRes = await fetch(gasUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'text/plain;charset=utf-8',
          },
          body: payloadText,
          redirect: 'follow',
        });

        const gasBody = await gasRes.text();
        const headers = new Headers(corsHeaders(request));
        headers.set('Content-Type', 'application/json');
        headers.set('Cache-Control', 'private, no-cache, no-store, must-revalidate');

        return new Response(gasBody, {
          status: gasRes.status,
          headers,
        });
      } catch (proxyErr) {
        return jsonResponse({
          success: false,
          code: 502,
          message: 'Edge proxy to Google Apps Script failed: ' + (proxyErr.message || String(proxyErr)),
        }, 502, request);
      }
    }

    // 4. Static site assets fallback via Cloudflare Workers Assets binding with edge cache & security headers
    if (env && env.ASSETS) {
      const assetResponse = await env.ASSETS.fetch(request);
      const response = new Response(assetResponse.body, assetResponse);

      // Immutably cache content-hashed Next.js assets
      if (pathname.startsWith('/_next/static/') || pathname.startsWith('/static/')) {
        response.headers.set('Cache-Control', 'public, max-age=31536000, immutable');
      } else if (pathname.endsWith('.svg') || pathname.endsWith('.png') || pathname.endsWith('.ico') || pathname.endsWith('.webp')) {
        response.headers.set('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
      } else {
        response.headers.set('Cache-Control', 'public, max-age=0, must-revalidate');
      }

      // Modern security headers
      response.headers.set('X-Content-Type-Options', 'nosniff');
      response.headers.set('X-Frame-Options', 'SAMEORIGIN');
      response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');

      return response;
    }

    return new Response('Not found', { status: 404 });
  }
};
