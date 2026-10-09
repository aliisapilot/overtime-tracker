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
  ID: string;
  Name: string;
  Address?: string;
  Latitude: number;
  Longitude: number;
  'Geofence Radius': number;
  Status: string;
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

const GAS_URL = process.env.NEXT_PUBLIC_GAS_WEB_APP_URL || '';

/**
 * Low-level transport sending text/plain POST to bypass browser CORS preflight
 * GAS returns HTTP 302 redirect to script.googleusercontent.com which sends Access-Control-Allow-Origin: *
 */
export async function sendGasRequest<T = Record<string, unknown>>(
  payload: Record<string, unknown>,
  timeoutMs: number = 20000
): Promise<ApiResponse<T>> {
  if (!GAS_URL || GAS_URL.includes('YOUR_SCRIPT_ID')) {
    return {
      success: false,
      message: 'Backend URL not configured. Set NEXT_PUBLIC_GAS_WEB_APP_URL in .env.local.'
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
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

    if (!response.ok && response.status !== 0) {
      return {
        success: false,
        code: response.status,
        message: `Backend returned HTTP status ${response.status}: ${response.statusText}`,
      };
    }

    const json = await response.json();
    return json as ApiResponse<T>;
  } catch (error: unknown) {
    clearTimeout(timer);
    const err = error as Error;
    if (err.name === 'AbortError') {
      return {
        success: false,
        message: 'Request timed out after 20 seconds. Please check your internet connection and try again.',
      };
    }
    return {
      success: false,
      message: err.message || 'Network error connecting to Google Apps Script backend.',
    };
  }
}

/**
 * Health check & connectivity verification
 */
export async function testPing(): Promise<{ ok: boolean; message: string; timestamp?: string }> {
  try {
    const res = await sendGasRequest<{ message: string; timestamp: string }>({ action: 'ping' });
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
 * Authenticate Employee ID & PIN
 */
export async function login(employeeId: string, pin: string): Promise<LoginResponse> {
  const cleanId = employeeId.trim().toUpperCase();
  const cleanPin = pin.trim();

  if (!cleanId) {
    return { success: false, message: 'Please enter your Employee ID (e.g. EMP000)' };
  }
  if (!cleanPin) {
    return { success: false, message: 'Please enter your PIN' };
  }

  const res = await sendGasRequest<LoginResponse>({
    action: 'login',
    employeeId: cleanId,
    pin: cleanPin,
  });

  return res as LoginResponse;
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
): Promise<ApiResponse<{ employeeId: string }>> {
  return sendGasRequest<{ employeeId: string }>({
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
 * Local session storage management
 */
const SESSION_STORAGE_KEY = 'overtime_tracker_session';

export function saveSession(session: UserSession): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  }
}

export function getSession(): UserSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as UserSession;
  } catch {
    return null;
  }
}

export function clearSession(): void {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(SESSION_STORAGE_KEY);
  }
}
