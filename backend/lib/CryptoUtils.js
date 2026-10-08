/**
 * Cryptographic utilities for Overtime Tracker
 * Standard RFC 2898 / RFC 7914 PBKDF2 (HMAC-SHA256) implementation
 * Fully verified against standard test vectors
 * Compatible with both Google Apps Script runtime and Node.js
 */

var _ConfigModule = (typeof CONFIG !== 'undefined') ? { CONFIG: CONFIG } : 
  (typeof require !== 'undefined' ? require('./Config') : { CONFIG: { PBKDF2_ITERATIONS: 25000, SESSION_TIMEOUT: 86400000, SALT_LENGTH: 32 } });
var _CONFIG = _ConfigModule.CONFIG;

var CryptoUtils = (function() {
  var _nodeRuntimeSecret = null;

  /**
   * Helper: compute HMAC-SHA256
   */
  function hmacSha256(value, key) {
    if (typeof Utilities !== 'undefined' && Utilities.computeHmacSha256Signature) {
      var raw = Utilities.computeHmacSha256Signature(value, key, Utilities.Charset.UTF_8);
      return raw.map(function(b) {
        return (b < 0 ? b + 256 : b).toString(16).padStart(2, '0');
      }).join('');
    } else {
      var crypto = require('crypto');
      return crypto.createHmac('sha256', key).update(value).digest('hex');
    }
  }

  /**
   * Helper: compute SHA-256
   */
  function sha256(value) {
    if (typeof Utilities !== 'undefined' && Utilities.computeDigest) {
      var raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8);
      return raw.map(function(b) {
        return (b < 0 ? b + 256 : b).toString(16).padStart(2, '0');
      }).join('');
    } else {
      var crypto = require('crypto');
      return crypto.createHash('sha256').update(value).digest('hex');
    }
  }

  /**
   * Helper: generate cryptographically random hex salt
   */
  function generateSalt(length) {
    length = length || _CONFIG.SALT_LENGTH || 32;
    if (typeof Utilities !== 'undefined' && Utilities.getUuid) {
      var uuids = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
      return uuids.substring(0, length);
    } else {
      var crypto = require('crypto');
      return crypto.randomBytes(Math.ceil(length / 2)).toString('hex').substring(0, length);
    }
  }

  /**
   * Base64 encode string (URL-safe)
   */
  function toBase64(str) {
    if (typeof Utilities !== 'undefined' && Utilities.base64EncodeWebSafe) {
      return Utilities.base64EncodeWebSafe(str);
    } else if (typeof Buffer !== 'undefined') {
      return Buffer.from(str, 'utf8').toString('base64url');
    } else {
      return btoa(unescape(encodeURIComponent(str)));
    }
  }

  /**
   * Base64 decode string
   */
  function fromBase64(b64) {
    if (typeof Utilities !== 'undefined' && Utilities.base64DecodeWebSafe) {
      var bytes = Utilities.base64DecodeWebSafe(b64);
      return Utilities.newBlob(bytes).getDataAsString();
    } else if (typeof Buffer !== 'undefined') {
      return Buffer.from(b64, 'base64url').toString('utf8');
    } else {
      return decodeURIComponent(escape(atob(b64)));
    }
  }

  /**
   * Constant-time string comparison to prevent timing attacks
   */
  function safeCompare(a, b) {
    if (!a || !b || a.length !== b.length) {
      return false;
    }
    var result = 0;
    for (var i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return result === 0;
  }

  /**
   * Convert string to byte array compatible with Google Apps Script signed bytes
   */
  function stringToBytes(str) {
    if (typeof Utilities !== 'undefined' && Utilities.newBlob) {
      return Utilities.newBlob(str).getBytes();
    } else if (typeof Buffer !== 'undefined') {
      var buf = Buffer.from(str, 'utf8');
      return Array.from(buf).map(function(b) { return (b > 127 ? b - 256 : b); });
    } else {
      var bytes = [];
      for (var i = 0; i < str.length; i++) {
        var code = str.charCodeAt(i);
        bytes.push(code > 127 ? code - 256 : code);
      }
      return bytes;
    }
  }

  /**
   * Standard RFC 2898 / RFC 7914 PBKDF2 (HMAC-SHA256) implementation
   * Verified against standard test vectors
   * @param {string} password
   * @param {string} salt
   * @param {number} iterations
   * @param {number} [dkLen] - Derived key length in bytes (default 32)
   * @returns {string} Hex-encoded derived key
   */
  function pbkdf2Standard(password, salt, iterations, dkLen) {
    dkLen = dkLen || 32;

    // Fast path if in Node.js
    if (typeof crypto !== 'undefined' && crypto.pbkdf2Sync) {
      return crypto.pbkdf2Sync(password, salt, iterations, dkLen, 'sha256').toString('hex');
    }
    if (typeof require !== 'undefined') {
      try {
        var nodeCrypto = require('crypto');
        if (nodeCrypto && nodeCrypto.pbkdf2Sync) {
          return nodeCrypto.pbkdf2Sync(password, salt, iterations, dkLen, 'sha256').toString('hex');
        }
      } catch (e) {
        // Fall back to pure GAS implementation below
      }
    }

    // Google Apps Script pure implementation using Utilities.computeHmacSha256Signature
    var passBytes = stringToBytes(password);
    var saltBytes = stringToBytes(salt);

    // Block 1: salt || 0x00 0x00 0x00 0x01
    var initial = saltBytes.concat([0, 0, 0, 1]);
    var u = Utilities.computeHmacSha256Signature(initial, passBytes);
    var t = u.slice();

    for (var i = 1; i < iterations; i++) {
      u = Utilities.computeHmacSha256Signature(u, passBytes);
      for (var j = 0; j < 32; j++) {
        t[j] = (t[j] ^ u[j]);
      }
    }

    return t.slice(0, dkLen).map(function(b) {
      return (b < 0 ? b + 256 : b).toString(16).padStart(2, '0');
    }).join('');
  }

  /**
   * Hash a PIN with standard RFC 2898 PBKDF2 and a unique 256-bit salt
   * @param {string} pin - Plain text PIN
   * @param {string} [salt] - Optional salt
   * @param {number} [iterations] - Optional iterations
   * @returns {string} Stored hash in format pbkdf2:<iterations>:<salt>:<hash>
   */
  function hashPin(pin, salt, iterations) {
    if (typeof pin !== 'string') {
      pin = String(pin || '');
    }
    salt = salt || generateSalt(_CONFIG.SALT_LENGTH || 32);
    iterations = iterations || _CONFIG.PBKDF2_ITERATIONS || 25000;
    var derived = pbkdf2Standard(pin, salt, iterations, 32);
    return 'pbkdf2:' + iterations + ':' + salt + ':' + derived;
  }

  /**
   * Verify a PIN against a stored hash using constant-time comparison
   * @param {string} pin - Plain text PIN
   * @param {string} storedHash - Stored hash string
   * @returns {{ valid: boolean, shouldUpgrade: boolean }}
   */
  function verifyPin(pin, storedHash) {
    if (!pin || !storedHash) {
      return { valid: false, shouldUpgrade: false };
    }
    if (typeof pin !== 'string') {
      pin = String(pin);
    }

    // Modern RFC PBKDF2 format: pbkdf2:iterations:salt:hash
    if (storedHash.indexOf('pbkdf2:') === 0) {
      var parts = storedHash.split(':');
      if (parts.length === 4) {
        var iterations = parseInt(parts[1], 10);
        var salt = parts[2];
        var expectedHash = parts[3];
        var computedHash = pbkdf2Standard(pin, salt, iterations, 32);
        var isValid = safeCompare(computedHash, expectedHash);
        var shouldUpgrade = isValid && (iterations < (_CONFIG.PBKDF2_ITERATIONS || 25000));
        return { valid: isValid, shouldUpgrade: shouldUpgrade };
      }
    }

    // Legacy fallback: SHA-256 base64 digest with static salt (from prototype)
    try {
      var legacyInput = pin + 'salt_' + pin.length;
      var legacyHex = sha256(legacyInput);
      var legacyBase64 = (typeof Utilities !== 'undefined' && Utilities.base64Encode) 
        ? Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, legacyInput))
        : (typeof Buffer !== 'undefined' ? Buffer.from(legacyHex, 'hex').toString('base64') : '');

      if (safeCompare(storedHash, legacyBase64) || safeCompare(storedHash, legacyHex)) {
        return { valid: true, shouldUpgrade: true };
      }
    } catch (e) {
      // ignore
    }

    return { valid: false, shouldUpgrade: false };
  }

  /**
   * Get or initialize server auth secret for signing tokens
   */
  function getAuthSecret() {
    if (typeof PropertiesService !== 'undefined' && PropertiesService.getScriptProperties) {
      var props = PropertiesService.getScriptProperties();
      var secret = props.getProperty('AUTH_SECRET');
      if (!secret) {
        secret = generateSalt(32) + generateSalt(32);
        props.setProperty('AUTH_SECRET', secret);
      }
      return secret;
    }
    if (typeof process !== 'undefined' && process.env && process.env.AUTH_SECRET) {
      return process.env.AUTH_SECRET;
    }
    if (!_nodeRuntimeSecret) {
      _nodeRuntimeSecret = generateSalt(32) + generateSalt(32);
    }
    return _nodeRuntimeSecret;
  }

  /**
   * Create a signed session token
   * @param {Object} payload - User session data
   * @returns {string} Token in format <payloadB64>.<signature>
   */
  function createSessionToken(payload) {
    var secret = getAuthSecret();
    var now = Date.now();
    var exp = now + (_CONFIG.SESSION_TIMEOUT || (24 * 60 * 60 * 1000));
    
    var tokenData = {
      employeeId: payload.employeeId,
      name: payload.name,
      role: payload.role,
      siteId: payload.siteId || '',
      iat: now,
      exp: exp
    };

    var encodedPayload = toBase64(JSON.stringify(tokenData));
    var signature = hmacSha256(encodedPayload, secret);
    return encodedPayload + '.' + signature;
  }

  /**
   * Verify and decode a session token
   * @param {string} token
   * @returns {Object|null} Session payload if valid, null otherwise
   */
  function verifySessionToken(token) {
    if (!token || typeof token !== 'string') {
      return null;
    }
    var parts = token.split('.');
    if (parts.length !== 2) {
      return null;
    }

    var encodedPayload = parts[0];
    var providedSignature = parts[1];
    var secret = getAuthSecret();
    var expectedSignature = hmacSha256(encodedPayload, secret);

    if (!safeCompare(providedSignature, expectedSignature)) {
      return null;
    }

    try {
      var jsonStr = fromBase64(encodedPayload);
      var payload = JSON.parse(jsonStr);
      if (!payload.exp || payload.exp < Date.now()) {
        return null; // Expired
      }
      return payload;
    } catch (e) {
      return null;
    }
  }

  return {
    pbkdf2Standard: pbkdf2Standard,
    hashPin: hashPin,
    verifyPin: verifyPin,
    createSessionToken: createSessionToken,
    verifySessionToken: verifySessionToken,
    getAuthSecret: getAuthSecret,
    generateSalt: generateSalt,
    hmacSha256: hmacSha256,
    sha256: sha256
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CryptoUtils;
}
