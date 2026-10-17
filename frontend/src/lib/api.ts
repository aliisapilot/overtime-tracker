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
  'Start Photo Key'?: string;
  startPhotoKey?: string;
  'Start Photo Captured At'?: string;
  startPhotoCapturedAt?: string;
  'Start Photo Verification Status'?: string;
  startPhotoStatus?: string;
  'End Photo Key'?: string;
  endPhotoKey?: string;
  'End Photo Captured At'?: string;
  endPhotoCapturedAt?: string;
  'End Photo Verification Status'?: string;
  endPhotoStatus?: string;
}

import { logDiagnostic, maskEmployeeId } from './diagnostics';

const GAS_URL =
  process.env.NEXT_PUBLIC_GAS_WEB_APP_URL ||
  'https://script.google.com/macros/s/AKfycbzAsJfsSviCiq47tTG6srTqAo4yZTFaGZDG0SQOPZjWNHdMSiyI8ELfuk2FmQ39QPcP/exec';

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

    let response: Response;
    const isBrowser = typeof window !== 'undefined';

    // In browser environment, attempt same-origin /api/gas edge proxy first for lower latency and connection reuse
    if (isBrowser) {
      try {
        const edgeRes = await fetch('/api/gas', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        // If edge proxy succeeds or returns expected application status, use it
        if (edgeRes.ok || (edgeRes.status !== 404 && edgeRes.status !== 502 && edgeRes.status !== 504)) {
          response = edgeRes;
        } else {
          // Fall back to direct GAS endpoint
          response = await fetch(GAS_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'text/plain;charset=utf-8',
            },
            body: JSON.stringify(payload),
            redirect: 'follow',
            signal: controller.signal,
          });
        }
      } catch {
        // Fall back directly to GAS if edge proxy network fails (e.g., local standalone next dev)
        response = await fetch(GAS_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'text/plain;charset=utf-8',
          },
          body: JSON.stringify(payload),
          redirect: 'follow',
          signal: controller.signal,
        });
      }
    } else {
      response = await fetch(GAS_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain;charset=utf-8',
        },
        body: JSON.stringify(payload),
        redirect: 'follow',
        signal: controller.signal,
      });
    }

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
 * Photo Upload Response
 */
export interface PhotoUploadResponse {
  success: boolean;
  photoKey?: string;
  photoProof?: string;
  capturedAt?: string;
  size?: number;
  message?: string;
}

/**
 * Upload verified attendance selfie to Cloudflare Worker R2 endpoint
 */
export async function uploadAttendancePhoto(
  token: string,
  employeeId: string,
  imageBase64: string,
  type: 'start' | 'end',
  capturedAt?: string
): Promise<PhotoUploadResponse> {
  try {
    const res = await fetch('/api/photos/upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        imageBase64,
        employeeId,
        type,
        capturedAt: capturedAt || new Date().toISOString(),
      }),
    });

    const data = await res.json();
    return data as PhotoUploadResponse;
  } catch (err: unknown) {
    return {
      success: false,
      message: (err as Error).message || 'Failed to connect to photo storage endpoint.',
    };
  }
}

/**
 * Get authorized photo preview URL with token query
 */
export function getPhotoViewUrl(photoKey?: string, token?: string): string {
  if (!photoKey) return '';
  return `/api/photos/view?key=${encodeURIComponent(photoKey)}&token=${encodeURIComponent(token || '')}`;
}

/**
 * Start Labourer Shift with GPS telemetry and mandatory selfie verification
 */
export async function startShift(
  token: string,
  employeeId: string,
  siteId: string,
  coords: { lat: number; lon: number; accuracy: number },
  photo: { photoKey: string; photoProof?: string; photoCapturedAt?: string }
): Promise<ApiResponse<{ shiftId: string; photoKey?: string; photoVerificationStatus?: string }>> {
  return sendGasRequest<{ shiftId: string; photoKey?: string; photoVerificationStatus?: string }>({
    action: 'startShift',
    token,
    employeeId,
    siteId,
    latitude: coords.lat,
    longitude: coords.lon,
    accuracy: coords.accuracy,
    photoKey: photo.photoKey,
    photoProof: photo.photoProof,
    photoCapturedAt: photo.photoCapturedAt || new Date().toISOString(),
  });
}

/**
 * End Labourer Shift with GPS telemetry and mandatory selfie verification
 */
export async function endShift(
  token: string,
  employeeId: string,
  coords: { lat: number; lon: number; accuracy: number },
  photo: { photoKey: string; photoProof?: string; photoCapturedAt?: string },
  breakMinutes: number = 60
): Promise<ApiResponse<{ shiftId: string; overtimeHours?: number; endPhotoKey?: string; endPhotoVerificationStatus?: string }>> {
  return sendGasRequest<{ shiftId: string; overtimeHours?: number; endPhotoKey?: string; endPhotoVerificationStatus?: string }>({
    action: 'endShift',
    token,
    employeeId,
    latitude: coords.lat,
    longitude: coords.lon,
    accuracy: coords.accuracy,
    photoKey: photo.photoKey,
    photoProof: photo.photoProof,
    photoCapturedAt: photo.photoCapturedAt || new Date().toISOString(),
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

  // Backward-compatibility fallback if deployed GAS has not yet registered getDashboardData
  if (!res.success && typeof res.message === 'string' && res.message.includes('getDashboardData')) {
    try {
      const [empRes, shiftsRes] = await Promise.all([
        getEmployeeData(token, employeeId),
        getEmployeeShifts(token, employeeId || ''),
      ]);

      const employee = empRes.success ? (empRes.data?.employee || (empRes as any).employee) : undefined;
      const jobSite = empRes.success ? (empRes.data?.jobSite || (empRes as any).jobSite) : undefined;
      const shifts = shiftsRes.success ? (shiftsRes.data?.shifts || (shiftsRes as any).shifts || []) : [];
      const activeShift = shifts.find((s: ShiftRecord) => s.Status === 'Active') || null;

      return {
        success: true,
        employee,
        jobSite,
        shifts,
        activeShift,
      };
    } catch {
      return res as unknown as DashboardResponse;
    }
  }

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
): Promise<ApiResponse<{ site: JobSite; jobSite?: JobSite }>> {
  const res = await sendGasRequest<{ site?: JobSite; jobSite?: JobSite }>({
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

  if (res.success && res.data) {
    const siteObj = res.data.site || res.data.jobSite;
    if (siteObj) {
      res.data.site = siteObj;
      res.data.jobSite = siteObj;
    }
  }

  return res as ApiResponse<{ site: JobSite; jobSite?: JobSite }>;
}

/**
 * Admin: Update Existing Job Site
 */
export async function updateJobSite(
  token: string,
  data: { siteId: string; name: string; address?: string; latitude: number; longitude: number; geofenceRadius: number; status?: string }
): Promise<ApiResponse<{ site: JobSite; jobSite?: JobSite }>> {
  const res = await sendGasRequest<{ site?: JobSite; jobSite?: JobSite }>({
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

  if (res.success && res.data) {
    const siteObj = res.data.site || res.data.jobSite;
    if (siteObj) {
      res.data.site = siteObj;
      res.data.jobSite = siteObj;
    }
  }

  return res as ApiResponse<{ site: JobSite; jobSite?: JobSite }>;
}

/**
 * Combined Admin Dashboard Data
 */
export interface AdminDashboardData {
  employees: EmployeeProfile[];
  jobSites: JobSite[];
  pendingOvertime: any[];
  activeShiftsCount: number;
  todayShiftsCount: number;
  totalEmployeesCount: number;
  archivedCount?: number;
}

export interface ArchivedEmployee {
  id: string;
  name: string;
  phone?: string;
  role: string;
  siteId?: string;
  siteName?: string;
  status: string;
  archivedAt?: string;
  archivedBy?: string;
  archiveReason?: string;
  historicalShiftsCount?: number;
  historicalTotalHours?: number;
}

export interface ArchivedJobSite {
  id: string;
  name: string;
  address?: string;
  lat?: number | null;
  lon?: number | null;
  geofenceRadius?: number;
  status: string;
  archivedAt?: string;
  archivedBy?: string;
  archiveReason?: string;
  historicalShiftsCount?: number;
}

export interface VoidedShift {
  id: string;
  shiftId: string;
  employeeId: string;
  employeeName: string;
  siteId: string;
  siteName: string;
  startTime: string;
  endTime?: string | null;
  regularHours: number;
  overtimeHours: number;
  status: string;
  voidReason?: string;
  voidedAt?: string;
  voidedBy?: string;
}

export interface VoidedOvertime {
  id: string;
  shiftId: string;
  employeeId: string;
  employeeName: string;
  date: string;
  overtimeHours: number;
  status: string;
  voidReason?: string;
  voidedAt?: string;
  voidedBy?: string;
}

export interface DuplicateRecord {
  type: string;
  recordType: string;
  id: string;
  name: string;
  phone?: string;
  status: string;
  siteId?: string;
  relatedCount: number;
  relatedRecords: Array<{
    id: string;
    name: string;
    phone?: string;
    siteId?: string;
    status: string;
  }>;
}

export interface ArchivedRecordsData {
  archivedEmployees: ArchivedEmployee[];
  archivedJobSites: ArchivedJobSite[];
  voidedShifts: VoidedShift[];
  voidedOvertime: VoidedOvertime[];
  duplicates: DuplicateRecord[];
  counts: {
    archivedEmployees: number;
    archivedJobSites: number;
    voidedShifts: number;
    voidedOvertime: number;
    duplicates: number;
  };
}

/**
 * Admin: Get Combined Dashboard Data in a Single Call
 * Significantly reduces cold-start delays and prevents parallel GAS request throttling.
 */
export async function getAdminDashboardData(token: string): Promise<ApiResponse<AdminDashboardData>> {
  const res = await sendGasRequest<AdminDashboardData>({
    action: 'getAdminDashboardData',
    token,
  });

  // If deployed GAS backend reports unsupported action for getAdminDashboardData,
  // gracefully fall back to individual endpoints so the dashboard renders immediately
  if (!res.success && typeof res.message === 'string' && res.message.includes('getAdminDashboardData')) {
    try {
      const [empRes, sitesRes, otRes, attRes] = await Promise.all([
        getEmployees(token),
        getJobSites(token),
        getPendingOvertime(token),
        getAttendance(token),
      ]);

      const employees = (empRes.data?.employees || (empRes as any).employees || []) as EmployeeProfile[];
      const jobSites = (sitesRes.data?.sites || (sitesRes as any).sites || (sitesRes.data as any)?.jobSites || (sitesRes as any).jobSites || []) as JobSite[];
      const pendingOvertime = (otRes.data?.overtime || (otRes as any).overtime || (otRes as any).pendingOvertime || []) as any[];
      const attendance = (attRes.data?.attendance || (attRes as any).attendance || []) as any[];

      const activeShiftsCount = Array.isArray(attendance)
        ? attendance.filter((a: any) => a.Status === 'Active' || a.status === 'Active').length
        : 0;

      return {
        success: true,
        data: {
          employees,
          jobSites,
          pendingOvertime,
          activeShiftsCount,
          todayShiftsCount: Array.isArray(attendance) ? attendance.length : 0,
          totalEmployeesCount: employees.length,
        },
      };
    } catch {
      return res;
    }
  }

  return res;
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
 * Admin: Archive Employee (Soft delete with history preservation)
 */
export async function archiveEmployee(
  token: string,
  employeeId: string,
  reason?: string
): Promise<ApiResponse> {
  return sendGasRequest({
    action: 'archiveEmployee',
    token,
    employeeId,
    reason,
  });
}

/**
 * Admin: Restore Archived Employee to Active
 */
export async function restoreEmployee(
  token: string,
  employeeId: string
): Promise<ApiResponse> {
  return sendGasRequest({
    action: 'restoreEmployee',
    token,
    employeeId,
  });
}

/**
 * Admin: Archive Job Site
 */
export async function archiveJobSite(
  token: string,
  siteId: string,
  reason?: string
): Promise<ApiResponse> {
  return sendGasRequest({
    action: 'archiveJobSite',
    token,
    siteId,
    reason,
  });
}

/**
 * Admin: Restore Archived Job Site
 */
export async function restoreJobSite(
  token: string,
  siteId: string
): Promise<ApiResponse> {
  return sendGasRequest({
    action: 'restoreJobSite',
    token,
    siteId,
  });
}

/**
 * Admin: Void Shift / Attendance Record with mandatory reason
 */
export async function voidShift(
  token: string,
  shiftId: string,
  reason: string
): Promise<ApiResponse> {
  return sendGasRequest({
    action: 'voidShift',
    token,
    shiftId,
    reason,
  });
}

/**
 * Admin: Cancel or Void Overtime Request with mandatory reason
 */
export async function voidOvertime(
  token: string,
  overtimeId: string,
  reason: string
): Promise<ApiResponse> {
  return sendGasRequest({
    action: 'voidOvertime',
    token,
    overtimeId,
    reason,
  });
}

/**
 * Admin: Purge Attendance Photo under Retention Policy
 */
export async function purgeAttendancePhoto(
  token: string,
  shiftId: string,
  photoType: 'start' | 'end',
  reason: string,
  policyAck: boolean = true
): Promise<ApiResponse> {
  return sendGasRequest({
    action: 'purgeAttendancePhoto',
    token,
    shiftId,
    photoType,
    reason,
    policyAck,
  });
}

/**
 * Admin: Purge Photo directly from Cloudflare R2 / Dev Storage
 */
export async function purgePhotoFromStorage(
  token: string,
  photoKey: string,
  reason: string
): Promise<ApiResponse> {
  try {
    const res = await fetch('/api/photos/delete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        photoKey,
        reason,
        policyAck: true,
      }),
    });
    return (await res.json()) as ApiResponse;
  } catch (err: unknown) {
    return {
      success: false,
      message: 'Failed to contact photo storage service: ' + (err as Error).message,
    };
  }
}

/**
 * Admin: Get Archived & Voided Records across the System
 */
export async function getArchivedRecords(
  token: string
): Promise<ApiResponse<ArchivedRecordsData>> {
  return sendGasRequest<ArchivedRecordsData>({
    action: 'getArchivedRecords',
    token,
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

