/**
 * Safe, Structured Authentication & Network Diagnostics
 * 
 * Strict Privacy Guidelines:
 * - NEVER logs PINs, tokens, salts, or passwords.
 * - Masks sensitive identifiers for safety.
 * - Distinguishes between Network Failures, Auth Failures, and Navigation Failures.
 */

export type DiagnosticPhase =
  | 'AUTH_INIT'
  | 'AUTH_NORMALIZED'
  | 'NETWORK_DISPATCH'
  | 'NETWORK_RETRY'
  | 'NETWORK_RESPONSE'
  | 'NETWORK_ERROR'
  | 'AUTH_SUCCESS'
  | 'AUTH_FAILURE'
  | 'SESSION_STORED'
  | 'NAVIGATION_START'
  | 'NAVIGATION_COMPLETE'
  | 'SESSION_RESTORED'
  | 'SESSION_EXPIRED';

export interface DiagnosticEvent {
  phase: DiagnosticPhase;
  timestamp: string;
  details?: Record<string, unknown>;
  latencyMs?: number;
}

const isDev = process.env.NODE_ENV !== 'production';

export function maskEmployeeId(id: string): string {
  if (!id) return '';
  const clean = id.trim().toUpperCase();
  if (clean.length <= 3) return clean;
  return clean.slice(0, 3) + '***' + clean.slice(-1);
}

export function logDiagnostic(
  phase: DiagnosticPhase,
  details?: Record<string, unknown>,
  latencyMs?: number
): void {
  const event: DiagnosticEvent = {
    phase,
    timestamp: new Date().toISOString(),
    details,
    latencyMs,
  };

  // Safe structured output in browser console
  const prefix = `[AUTH DIAGNOSTICS] [${event.phase}]`;
  const meta = latencyMs !== undefined ? `(${latencyMs}ms)` : '';

  if (phase === 'AUTH_FAILURE' || phase === 'NETWORK_ERROR') {
    console.warn(prefix, meta, details || '');
  } else {
    // Info level in dev, collapsed debug in prod
    if (isDev) {
      console.log(prefix, meta, details || '');
    } else {
      console.debug(prefix, meta, details || '');
    }
  }
}
