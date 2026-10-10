/**
 * Google Apps Script Web App Client
 * Handles CORS-safe transport, redirect following, authentication, and shift operations.
 */

export interface EmployeeProfile {
  id: string;
  name: string;
  role: 'Admin' | 'Labourer';
  phone?: string;
  siteId?: string;
  siteName?: string;
  siteLat?: number | null;
  siteLon?: number | null;
  geofenceRadius?: number;
  status: string;
}

export interface UserSession {
  token: string;
  employee: EmployeeProfile;
  expiresAt?: string;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  message?: string;
  code?: number;
  data?: T;
  [key: string]: unknown;
}

export interface JobSite {
  id?: string;
  ID?: string;
  name?: string;
  Name?: string;
  address?: string;
  Address?: string;
  lat?: number;
  Latitude?: number;
  lon?: number;
  Longitude?: number;
  geofenceRadius?: number;
  'Geofence Radius'?: number;
  status?: string;
  Status?: string;
  createdAt?: string;
}

export interface ShiftRecord {
  ID: string;
  'Employee ID': string;
  'Site ID': string;
  'Start Time': string;
  'End Time'?: string;
  'Start Latitude': number;
  'Start Longitude': number;
  'Start Accuracy': number;
  'End Latitude'?: number;
  'End Longitude'?: number;
  'End Accuracy'?: number;
  'Break Minutes': number;
  'Regular Hours'?: number;
  'Overtime Hours'?: number;
  Status: 'Active' | 'Completed';
  'Created At': string;
}

import { logDiagnostic, maskEmployeeId } from './diagnostics';

const GAS_URL = process.env.NEXT_PUBLIC_GAS_WEB_APP_URL || '';

/**
 * Normalize employee IDs to standard sequential format (e.g. 1 -> EMP001, EMP1 -> EMP001, 0 -> EMP000)
 */
export function normalizeEmployeeId(rawId: string): string {
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

/**
 * Low-level transport sending text/plain POST to bypass browser CORS preflight
 * GAS returns HTTP 302 redirect to script.googleusercontent.com which sends Access-Control-Allow-Origin: *
 */
export async function sendGasRequest<T = Record<string, unknown>>(
  payload: Record<string, unknown>,
  timeoutMs: number = 35000,
  externalSignal?: AbortSignal
): Promise<ApiResponse<T>> {
  if (!GAS_URL || GAS_URL.includes('YOUR_SCRIPT_ID')) {
    logDiagnostic('NETWORK_ERROR', { reason: 'GAS_URL not configured' });
    return {
      success: false,
      message: 'Backend URL not configured. Set NEXT_PUBLIC_GAS_WEB_APP_URL in .env.local.'
    };
  }

  const controller = new AbortController();
  const startTime = Date.now();
  let timedOut = false;

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  // Link external signal if provided (e.g. cancelling ping when login starts)
  if (externalSignal) {
    if (externalSignal.aborted) {
      clearTimeout(timer);
      controller.abort();
    } else {
      externalSignal.addEventListener('abort', () => {
        clearTimeout(timer);
        controller.abort();
      }, { once: true });
    }
  }

  const action = typeof payload.action === 'string' ? payload.action : 'unknown';

  try {
    logDiagnostic('NETWORK_DISPATCH', {
      action,
      timeoutMs,
      endpointConfigured: true,
    });

    const response = await fetch(GAS_URL, {
      method: 'POST',
      headers: {
        // text/plain;charset=utf-8 is a CORS-safelisted content-type
        // Prevents browser from issuing an OPTIONS preflight that GAS rejects
        'Content-Type': 'text/plain;charset=utf-8',
      },
      body: JSON.stringify(payload),
      redirect: 'follow',
      signal: controller.signal,
    });

    clearTimeout(timer);
    const latencyMs = Date.now() - startTime;

    if (!response.ok && response.status !== 0) {
      logDiagnostic('NETWORK_ERROR', {
        action,
        status: response.status,
        statusText: response.statusText,
      }, latencyMs);

      return {
        success: false,
        code: response.status,
        message: `Backend returned HTTP status ${response.status}: ${response.statusText}`,
      };
    }

    const json = (await response.json()) as ApiResponse<T>;

    logDiagnostic('NETWORK_RESPONSE', {
      action,
      status: response.status,
      success: json.success,
      code: json.code,
    }, latencyMs);

    // If server reports unauthorized or expired token, clear stale session and broadcast event
    if (json.code === 401 || (json.message && json.message.toLowerCase().includes('expired session'))) {
      logDiagnostic('SESSION_EXPIRED', { action });
      clearSession();
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('auth:expired'));
      }
    }

    return json;
  } catch (error: unknown) {
    clearTimeout(timer);
    const latencyMs = Date.now() - startTime;
    const err = error as Error;

    if (timedOut || err.name === 'AbortError') {
      logDiagnostic('NETWORK_ERROR', {
        action,
        reason: 'timeout_or_aborted',
        timeoutMs,
      }, latencyMs);

      return {
        success: false,
        code: 408,
        message: `Request timed out after ${Math.round(timeoutMs / 1000)} seconds. Google Apps Script is likely warming up. Please try again.`,
      };
    }

    logDiagnostic('NETWORK_ERROR', {
      action,
      reason: 'fetch_exception',
      error: err.message,
    }, latencyMs);

    return {
      success: false,
      code: 0,
      message: err.message || 'Network error connecting to Google Apps Script backend.',
    };
  }
}

/**
 * Health check & connectivity verification
 */
export async function testPing(signal?: AbortSignal): Promise<{ ok: boolean; message: string; timestamp?: string }> {
  try {
    const res = await sendGasRequest<{ message: string; timestamp: string }>({ action: 'ping' }, 15000, signal);
    if (res.success) {
      return { ok: true, message: 'Connected to Google Apps Script backend', timestamp: res.timestamp as string };
    }
    return { ok: false, message: res.message || 'Ping failed' };
  } catch (err: unknown) {
    return { ok: false, message: (err as Error).message };
  }
}

export interface LoginResponse extends ApiResponse {
  token?: string;
  employee?: EmployeeProfile;
}

/**
 * Authenticate Employee ID & PIN with:
 * - Sequential ID normalization (e.g. 1 -> EMP001, EMP1 -> EMP001)
 * - 45-second adaptive timeout for cold-start resilience
 * - Safe bounded retry for network failures (never retry invalid PIN attempts)
 * - Structured diagnostics without credential leakage
 */
export async function login(employeeId: string, pin: string): Promise<LoginResponse> {
  const normalizedId = normalizeEmployeeId(employeeId);
  const cleanPin = pin.trim();

  if (!normalizedId) {
    return { success: false, message: 'Please enter your Employee ID (e.g. EMP000, EMP001, or 1)' };
  }
  if (!cleanPin) {
    return { success: false, message: 'Please enter your PIN' };
  }

  logDiagnostic('AUTH_INIT', {
    employeeId: maskEmployeeId(normalizedId),
  });

  const payload = {
    action: 'login',
    employeeId: normalizedId,
    pin: cleanPin,
  };

  // Attempt 1: Generous 45-second timeout to accommodate initial GAS cold start
  const rawRes = await sendGasRequest<LoginResponse>(payload, 45000);
  const res = rawRes as LoginResponse;

  // If the server answered (even with invalid credentials), DO NOT retry
  if (res.code !== 408 && res.code !== 0 && res.success !== undefined) {
    if (res.success) {
      logDiagnostic('AUTH_SUCCESS', {
        employeeId: maskEmployeeId(normalizedId),
        role: res.employee?.role,
      });
    } else {
      logDiagnostic('AUTH_FAILURE', {
        employeeId: maskEmployeeId(normalizedId),
        message: res.message,
      });
    }
    return res;
  }

  // Network failure or cold-start timeout occurred (code === 408 or code === 0):
  // Safe bounded retry (Attempt 2) - backend may now be warm
  logDiagnostic('NETWORK_RETRY', {
    employeeId: maskEmployeeId(normalizedId),
    attempt: 2,
    previousCode: res.code,
  });

  // Brief pause to allow cellular/WiFi socket reset and GAS container warm-up
  await new Promise((resolve) => setTimeout(resolve, 1200));

  const rawRetry = await sendGasRequest<LoginResponse>(payload, 35000);
  const retryRes = rawRetry as LoginResponse;

  if (retryRes.success) {
    logDiagnostic('AUTH_SUCCESS', {
      employeeId: maskEmployeeId(normalizedId),
      role: retryRes.employee?.role,
      recoveredViaRetry: true,
    });
  } else if (retryRes.code !== 408 && retryRes.code !== 0) {
    logDiagnostic('AUTH_FAILURE', {
      employeeId: maskEmployeeId(normalizedId),
      message: retryRes.message,
      recoveredViaRetry: false,
    });
  } else {
    logDiagnostic('NETWORK_ERROR', {
      employeeId: maskEmployeeId(normalizedId),
      message: 'Both initial attempt and network retry timed out.',
    });
  }

  return retryRes as LoginResponse;
}

/**
 * Start Labourer Shift with GPS telemetry
 */
export async function startShift(
  token: string,
  employeeId: string,
  siteId: string,
  coords: { lat: number; lon: number; accuracy: number }
): Promise<ApiResponse<{ shiftId: string }>> {
  return sendGasRequest<{ shiftId: string }>({
    action: 'startShift',
    token,
    employeeId,
    siteId,
    latitude: coords.lat,
    longitude: coords.lon,
    accuracy: coords.accuracy,
  });
}

/**
 * End Labourer Shift with GPS telemetry
 */
export async function endShift(
  token: string,
  employeeId: string,
  coords: { lat: number; lon: number; accuracy: number },
  breakMinutes: number = 60
): Promise<ApiResponse<{ shiftId: string; overtimeHours?: number }>> {
  return sendGasRequest<{ shiftId: string; overtimeHours?: number }>({
    action: 'endShift',
    token,
    employeeId,
    latitude: coords.lat,
    longitude: coords.lon,
    accuracy: coords.accuracy,
    breakMinutes,
  });
}

/**
 * Fetch Shifts for Employee
 */
export async function getEmployeeShifts(token: string, employeeId: string): Promise<ApiResponse<{ shifts: ShiftRecord[] }>> {
  return sendGasRequest<{ shifts: ShiftRecord[] }>({
    action: 'getEmployeeShifts',
    token,
    employeeId,
  });
}

/**
 * Fetch Detailed Employee Profile and Assigned Site
 */
export async function getEmployeeData(token: string, employeeId?: string): Promise<ApiResponse<{ employee: EmployeeProfile; jobSite?: JobSite }>> {
  return sendGasRequest<{ employee: EmployeeProfile; jobSite?: JobSite }>({
    action: 'getEmployeeData',
    token,
    employeeId,
  });
}

export interface DashboardResponse extends ApiResponse {
  employee?: EmployeeProfile;
  jobSite?: JobSite;
  shifts?: ShiftRecord[];
  activeShift?: ShiftRecord | null;
}

/**
 * Fetch combined dashboard data in one GAS call:
 * employee profile + job site + all shifts + active shift
 * Eliminates two parallel requests on labourer dashboard load.
 */
export async function getDashboardData(token: string, employeeId?: string): Promise<DashboardResponse> {
  const res = await sendGasRequest<Record<string, unknown>>({
    action: 'getDashboardData',
    token,
    employeeId,
  });
  return res as unknown as DashboardResponse;
}

/**
 * Admin: Get Job Sites
 */
export async function getJobSites(token: string): Promise<ApiResponse<{ sites: JobSite[] }>> {
  return sendGasRequest<{ sites: JobSite[] }>({
    action: 'getJobSites',
    token,
  });
}

/**
 * Admin: Create New Employee
 */
export async function createEmployee(
  token: string,
  data: { employeeId?: string; name: string; phone: string; role?: 'Labourer' | 'Admin'; siteId?: string; pin: string }
): Promise<ApiResponse<{ employee: EmployeeProfile }>> {
  return sendGasRequest<{ employee: EmployeeProfile }>({
    action: 'createEmployee',
    token,
    ...data,
  });
}

/**
 * Admin: Update Existing Employee (ID, Name, Phone, Role, Site, Status, PIN)
 */
export async function updateEmployee(
  token: string,
  data: {
    currentId: string;
    newId?: string;
    name?: string;
    phone?: string;
    role?: 'Labourer' | 'Admin';
    siteId?: string;
    status?: string;
    pin?: string;
  }
): Promise<ApiResponse<{ employeeId: string; employee?: EmployeeProfile }>> {
  return sendGasRequest<{ employeeId: string; employee?: EmployeeProfile }>({
    action: 'updateEmployee',
    token,
    ...data,
  });
}

/**
 * Admin: Create New Job Site
 */
export async function createJobSite(
  token: string,
  data: { name: string; address?: string; latitude: number; longitude: number; geofenceRadius: number }
): Promise<ApiResponse<{ site: JobSite }>> {
  return sendGasRequest<{ site: JobSite }>({
    action: 'createJobSite',
    token,
    name: data.name,
    address: data.address,
    lat: data.latitude,
    lon: data.longitude,
    latitude: data.latitude,
    longitude: data.longitude,
    geofenceRadius: data.geofenceRadius,
  });
}

/**
 * Admin: Update Existing Job Site
 */
export async function updateJobSite(
  token: string,
  data: { siteId: string; name: string; address?: string; latitude: number; longitude: number; geofenceRadius: number; status?: string }
): Promise<ApiResponse<{ site: JobSite }>> {
  return sendGasRequest<{ site: JobSite }>({
    action: 'updateJobSite',
    token,
    siteId: data.siteId,
    id: data.siteId,
    name: data.name,
    address: data.address,
    lat: data.latitude,
    lon: data.longitude,
    latitude: data.latitude,
    longitude: data.longitude,
    geofenceRadius: data.geofenceRadius,
    status: data.status,
  });
}

/**
 * Admin: Get All Employees
 */
export async function getEmployees(token: string): Promise<ApiResponse<{ employees: EmployeeProfile[] }>> {
  return sendGasRequest<{ employees: EmployeeProfile[] }>({
    action: 'getEmployees',
    token,
  });
}

/**
 * Admin: Get Attendance for Date
 */
export async function getAttendance(token: string, date?: string): Promise<ApiResponse<{ attendance: unknown[] }>> {
  return sendGasRequest<{ attendance: unknown[] }>({
    action: 'getAttendance',
    token,
    date,
  });
}

/**
 * Admin: Get Pending Overtime Records
 */
export async function getPendingOvertime(token: string): Promise<ApiResponse<{ overtime: unknown[] }>> {
  return sendGasRequest<{ overtime: unknown[] }>({
    action: 'getPendingOvertime',
    token,
  });
}

/**
 * Admin: Approve Overtime Record
 */
export async function approveOvertime(token: string, overtimeId: string): Promise<ApiResponse> {
  return sendGasRequest({
    action: 'approveOvertime',
    token,
    overtimeId,
  });
}

/**
 * Admin: Get Audit Logs
 */
export async function getAuditLogs(token: string, limit?: number): Promise<ApiResponse<{ logs: unknown[] }>> {
  return sendGasRequest<{ logs: unknown[] }>({
    action: 'getAuditLogs',
    token,
    limit,
  });
}

/**
 * Change PIN (Self-service for Labourer or Admin)
 */
export async function changePin(
  token: string,
  currentPin: string,
  newPin: string
): Promise<ApiResponse> {
  return sendGasRequest({
    action: 'changePin',
    token,
    currentPin,
    newPin,
  });
}

/**
 * Admin: Generate Daily Attendance Report
 */
export async function generateDailyReport(
  token: string,
  date?: string
): Promise<ApiResponse<{ report: unknown }>> {
  return sendGasRequest<{ report: unknown }>({
    action: 'generateDailyReport',
    token,
    date,
  });
}

/**
 * Admin: Generate Monthly Attendance Report
 */
export async function generateMonthlyReport(
  token: string,
  month?: string
): Promise<ApiResponse<{ report: unknown }>> {
  return sendGasRequest<{ report: unknown }>({
    action: 'generateMonthlyReport',
    token,
    month,
  });
}

/**
 * Local session storage management & expiration validation
 */
const SESSION_STORAGE_KEY = 'overtime_tracker_session';

/**
 * Validate that a session object is structured properly and not expired
 */
export function isSessionValid(session: UserSession | null): boolean {
  if (!session || !session.token || !session.employee) return false;
  try {
    const parts = session.token.split('.');
    if (parts.length !== 2) return false;
    
    // Decode base64url payload
    const base64 = parts[0].replace(/-/g, '+').replace(/_/g, '/');
    const jsonStr = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    const payload = JSON.parse(jsonStr);

    if (payload.exp && typeof payload.exp === 'number') {
      const now = Date.now();
      // Allow 30-second leeway
      if (payload.exp <= now + 30000) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

export function saveSession(session: UserSession): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
    logDiagnostic('SESSION_STORED', {
      employeeId: maskEmployeeId(session.employee?.id),
      role: session.employee?.role,
    });
  }
}

export function getSession(): UserSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as UserSession;

    if (!isSessionValid(session)) {
      logDiagnostic('SESSION_EXPIRED', { reason: 'stale_or_invalid_token' });
      localStorage.removeItem(SESSION_STORAGE_KEY);
      return null;
    }

    logDiagnostic('SESSION_RESTORED', {
      employeeId: maskEmployeeId(session.employee?.id),
      role: session.employee?.role,
    });
    return session;
  } catch {
    localStorage.removeItem(SESSION_STORAGE_KEY);
    return null;
  }
}

export function clearSession(): void {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(SESSION_STORAGE_KEY);
    logDiagnostic('SESSION_EXPIRED', { reason: 'user_logout_or_cleared' });
  }
}

