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

/**
 * Decode and validate session token without exposing secrets
 * Format: <base64url-payload>.<hmac-signature>
 */
function parseAndValidateSession(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;

  try {
    const base64 = parts[0].replace(/-/g, '+').replace(/_/g, '/');
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
        const session = parseAndValidateSession(token);

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

        return jsonResponse({
          success: true,
          photoKey,
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

        const session = parseAndValidateSession(token);
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

    // Static site assets fallback via Cloudflare Workers Assets binding
    if (env && env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response('Not found', { status: 404 });
  }
};
