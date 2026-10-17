/**
 * Centralized SWR Data Layer for Overtime Tracker
 * Provides instant cached rendering, background stale-while-revalidate,
 * request deduplication, and targeted instant CRUD cache updates.
 */

import useSWR, { mutate as globalMutate } from 'swr';
import { useCallback, useEffect } from 'react';
import {
  AdminDashboardData,
  ApiResponse,
  ArchivedRecordsData,
  DashboardResponse,
  EmployeeProfile,
  JobSite,
  ShiftRecord,
  getAdminDashboardData,
  getArchivedRecords,
  getAttendance,
  getAuditLogs,
  getDashboardData,
  generateDailyReport,
} from './api';

const ADMIN_CACHE_KEY_PREFIX = 'ot_cache_admin_dashboard_v2';
const LABOURER_CACHE_KEY_PREFIX = 'ot_cache_labourer_dashboard_v2';

// Safe localStorage cache helpers
function loadCachedData<T>(key: string): T | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.data) {
      return parsed.data as T;
    }
  } catch {
    // Ignore JSON parse errors
  }
  return undefined;
}

function saveCachedData<T>(key: string, data: T): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify({
      data,
      timestamp: Date.now(),
    }));
  } catch {
    // Quota exceeded or private browsing
  }
}

/**
 * Hook: Admin Dashboard (Workforce, Job Sites, Overtime Counts, Summary)
 * Returns cached data immediately (< 20ms) and revalidates silently.
 */
export function useAdminDashboard(token: string) {
  const swrKey = token ? `admin-dashboard-${token.slice(-12)}` : null;
  const storageKey = ADMIN_CACHE_KEY_PREFIX;

  const { data, error, isLoading, isValidating, mutate } = useSWR<AdminDashboardData>(
    swrKey,
    async () => {
      const res = await getAdminDashboardData(token);
      if (!res.success || !res.data) {
        throw new Error(res.message || 'Failed to load admin dashboard data from server.');
      }
      saveCachedData(storageKey, res.data);
      return res.data;
    },
    {
      fallbackData: loadCachedData<AdminDashboardData>(storageKey),
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
      dedupingInterval: 5000,
      keepPreviousData: true,
      shouldRetryOnError: true,
      errorRetryCount: 2,
    }
  );

  // Sync to local storage on fresh data
  useEffect(() => {
    if (data) {
      saveCachedData(storageKey, data);
    }
  }, [data, storageKey]);

  // Targeted Cache Mutation: Add Employee
  const addEmployeeLocally = useCallback((newEmp: EmployeeProfile) => {
    mutate(
      (current) => {
        if (!current) {
          return {
            employees: [newEmp],
            jobSites: [],
            pendingOvertime: [],
            activeShiftsCount: 0,
            todayShiftsCount: 0,
            totalEmployeesCount: 1,
          };
        }
        const exists = current.employees.some((e) => e.id === newEmp.id);
        const updatedEmployees = exists
          ? current.employees.map((e) => (e.id === newEmp.id ? { ...e, ...newEmp } : e))
          : [...current.employees, newEmp];
        return {
          ...current,
          employees: updatedEmployees,
          totalEmployeesCount: updatedEmployees.length,
        };
      },
      { revalidate: true }
    );
  }, [mutate]);

  // Targeted Cache Mutation: Update Employee
  const updateEmployeeLocally = useCallback((updatedEmp: EmployeeProfile) => {
    mutate(
      (current) => {
        if (!current) return current;
        return {
          ...current,
          employees: current.employees.map((e) =>
            e.id === updatedEmp.id ? { ...e, ...updatedEmp } : e
          ),
        };
      },
      { revalidate: true }
    );
  }, [mutate]);

  // Targeted Cache Mutation: Add Job Site
  const addJobSiteLocally = useCallback((newSite: JobSite) => {
    mutate(
      (current) => {
        if (!current) return current;
        const newId = newSite.ID || newSite.id;
        const exists = current.jobSites.some((s) => (s.ID || s.id) === newId);
        const updatedSites = exists
          ? current.jobSites.map((s) => ((s.ID || s.id) === newId ? { ...s, ...newSite } : s))
          : [...current.jobSites, newSite];
        return {
          ...current,
          jobSites: updatedSites,
        };
      },
      { revalidate: true }
    );
  }, [mutate]);

  // Targeted Cache Mutation: Update Job Site
  const updateJobSiteLocally = useCallback((updatedSite: JobSite) => {
    mutate(
      (current) => {
        if (!current) return current;
        const targetId = updatedSite.ID || updatedSite.id;
        return {
          ...current,
          jobSites: current.jobSites.map((s) =>
            (s.ID || s.id) === targetId ? { ...s, ...updatedSite } : s
          ),
        };
      },
      { revalidate: true }
    );
  }, [mutate]);

  // Targeted Cache Mutation: Approve Overtime
  const approveOvertimeLocally = useCallback((overtimeId: string) => {
    mutate(
      (current) => {
        if (!current) return current;
        const updatedList = current.pendingOvertime.filter(
          (o: { ID?: string; id?: string }) => (o.ID || o.id) !== overtimeId
        );
        return {
          ...current,
          pendingOvertime: updatedList,
        };
      },
      { revalidate: true }
    );
  }, [mutate]);

  // Targeted Cache Mutation: Archive Employee
  const archiveEmployeeLocally = useCallback((employeeId: string) => {
    mutate(
      (current) => {
        if (!current) return current;
        const updatedEmployees = current.employees.map((e) =>
          e.id === employeeId ? { ...e, status: 'Archived' } : e
        );
        const activeCount = updatedEmployees.filter((e) => e.status !== 'Archived').length;
        return {
          ...current,
          employees: updatedEmployees,
          totalEmployeesCount: activeCount,
        };
      },
      { revalidate: true }
    );
  }, [mutate]);

  // Targeted Cache Mutation: Restore Employee
  const restoreEmployeeLocally = useCallback((restoredEmp: EmployeeProfile) => {
    mutate(
      (current) => {
        if (!current) return current;
        const updatedEmployees = current.employees.map((e) =>
          e.id === restoredEmp.id ? { ...e, ...restoredEmp, status: 'Active' } : e
        );
        const activeCount = updatedEmployees.filter((e) => e.status !== 'Archived').length;
        return {
          ...current,
          employees: updatedEmployees,
          totalEmployeesCount: activeCount,
        };
      },
      { revalidate: true }
    );
  }, [mutate]);

  // Targeted Cache Mutation: Archive Job Site
  const archiveJobSiteLocally = useCallback((siteId: string) => {
    mutate(
      (current) => {
        if (!current) return current;
        const updatedSites = current.jobSites.map((s) => {
          const sid = s.ID || s.id;
          return sid === siteId ? { ...s, status: 'Archived', Status: 'Archived' } : s;
        });
        return {
          ...current,
          jobSites: updatedSites,
        };
      },
      { revalidate: true }
    );
  }, [mutate]);

  // Targeted Cache Mutation: Restore Job Site
  const restoreJobSiteLocally = useCallback((restoredSite: JobSite) => {
    mutate(
      (current) => {
        if (!current) return current;
        const targetId = restoredSite.ID || restoredSite.id;
        const updatedSites = current.jobSites.map((s) => {
          const sid = s.ID || s.id;
          return sid === targetId ? { ...s, ...restoredSite, status: 'Active', Status: 'Active' } : s;
        });
        return {
          ...current,
          jobSites: updatedSites,
        };
      },
      { revalidate: true }
    );
  }, [mutate]);

  // Targeted Cache Mutation: Void / Cancel Overtime
  const voidOvertimeLocally = useCallback((overtimeId: string) => {
    mutate(
      (current) => {
        if (!current) return current;
        const updatedList = current.pendingOvertime.filter(
          (o: { ID?: string; id?: string }) => (o.ID || o.id) !== overtimeId
        );
        return {
          ...current,
          pendingOvertime: updatedList,
        };
      },
      { revalidate: true }
    );
  }, [mutate]);

  // Manual Sync trigger
  const syncNow = useCallback(async () => {
    try {
      await mutate();
      return { success: true };
    } catch (err: unknown) {
      return { success: false, message: (err as Error).message };
    }
  }, [mutate]);

  return {
    dashboard: data,
    employees: data?.employees || [],
    jobSites: data?.jobSites || [],
    pendingOvertime: data?.pendingOvertime || [],
    activeShiftsCount: data?.activeShiftsCount ?? null,
    todayShiftsCount: data?.todayShiftsCount ?? null,
    totalEmployeesCount: data?.totalEmployeesCount ?? (data?.employees?.length ?? null),
    archivedCount: data?.archivedCount ?? null,
    isLoading: isLoading && !data,
    isValidating,
    isFirstLoad: isLoading && !data,
    hasCachedData: Boolean(data),
    error: error ? (error as Error).message : null,
    addEmployeeLocally,
    updateEmployeeLocally,
    archiveEmployeeLocally,
    restoreEmployeeLocally,
    addJobSiteLocally,
    updateJobSiteLocally,
    archiveJobSiteLocally,
    restoreJobSiteLocally,
    approveOvertimeLocally,
    voidOvertimeLocally,
    syncNow,
  };
}

/**
 * Hook: Attendance Ledger (loads independently from Dashboard to prevent blocking)
 */
export function useAdminAttendance(token: string, date?: string) {
  const swrKey = token ? `admin-attendance-${token.slice(-12)}-${date || 'all'}` : null;

  const { data, error, isLoading, isValidating, mutate } = useSWR<unknown[]>(
    swrKey,
    async () => {
      const res = await getAttendance(token, date);
      if (!res.success || !Array.isArray(res.attendance)) {
        throw new Error(res.message || 'Failed to retrieve attendance records.');
      }
      return res.attendance;
    },
    {
      revalidateOnFocus: false,
      dedupingInterval: 10000,
      keepPreviousData: true,
      shouldRetryOnError: true,
    }
  );

  const voidShiftLocally = useCallback((shiftId: string) => {
    mutate(
      (current) => {
        if (!Array.isArray(current)) return current;
        return current.map((item: any) => {
          const id = item.ID || item.shiftId;
          return id === shiftId ? { ...item, status: 'Voided', Status: 'Voided' } : item;
        });
      },
      { revalidate: true }
    );
  }, [mutate]);

  return {
    attendance: data || [],
    isLoading: isLoading && !data,
    isValidating,
    error: error ? (error as Error).message : null,
    refreshAttendance: mutate,
    voidShiftLocally,
  };
}

/**
 * Hook: Audit Logs (Loaded lazily ONLY when Ateeb opens the audit tab)
 */
export function useAdminAuditLogs(token: string, enabled: boolean) {
  const swrKey = token && enabled ? `admin-audit-logs-${token.slice(-12)}` : null;

  const { data, error, isLoading, isValidating, mutate } = useSWR<unknown[]>(
    swrKey,
    async () => {
      const res = await getAuditLogs(token, 100);
      if (!res.success || !Array.isArray(res.logs)) {
        throw new Error(res.message || 'Failed to retrieve audit trail.');
      }
      return res.logs;
    },
    {
      revalidateOnFocus: false,
      dedupingInterval: 15000,
      keepPreviousData: true,
    }
  );

  return {
    auditLogs: data || [],
    isLoading: isLoading && !data,
    isValidating,
    error: error ? (error as Error).message : null,
    refreshAuditLogs: mutate,
  };
}

/**
 * Hook: Daily Reports by Date (cached per date so switching back is instant)
 */
export function useDailyReport(token: string, date: string) {
  const swrKey = token && date ? `admin-daily-report-${token.slice(-12)}-${date}` : null;

  const { data, error, isLoading, isValidating, mutate } = useSWR(
    swrKey,
    async () => {
      const res = await generateDailyReport(token, date);
      if (!res.success || !res.report) {
        throw new Error(res.message || 'Failed to generate report for selected date.');
      }
      return res.report;
    },
    {
      revalidateOnFocus: false,
      dedupingInterval: 30000,
      keepPreviousData: true,
    }
  );

  return {
    report: data,
    isLoading: isLoading && !data,
    isValidating,
    error: error ? (error as Error).message : null,
    refreshReport: mutate,
  };
}

/**
 * Hook: Labourer Dashboard (Worker profile, assigned job site, recent shifts, active shift)
 */
export function useLabourerDashboard(token: string, employeeId: string) {
  const swrKey = token && employeeId ? `labourer-dashboard-${employeeId}` : null;
  const storageKey = `${LABOURER_CACHE_KEY_PREFIX}_${employeeId}`;

  const { data, error, isLoading, isValidating, mutate } = useSWR<DashboardResponse>(
    swrKey,
    async () => {
      const res = await getDashboardData(token, employeeId);
      if (!res.success) {
        throw new Error(res.message || 'Failed to load employee shift records.');
      }
      saveCachedData(storageKey, res);
      return res;
    },
    {
      fallbackData: loadCachedData<DashboardResponse>(storageKey),
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
      dedupingInterval: 4000,
      keepPreviousData: true,
    }
  );

  useEffect(() => {
    if (data) {
      saveCachedData(storageKey, data);
    }
  }, [data, storageKey]);

  // Update shift state immediately upon confirmed server response
  const applyConfirmedShift = useCallback((shiftRecord: ShiftRecord, isStart: boolean) => {
    mutate(
      (current) => {
        if (!current) return current;
        if (isStart) {
          return {
            ...current,
            activeShift: shiftRecord,
            shifts: [shiftRecord, ...(current.shifts || [])],
          };
        } else {
          const updatedShifts = (current.shifts || []).map((s) =>
            s.ID === shiftRecord.ID ? { ...s, ...shiftRecord, Status: 'Completed' as const } : s
          );
          return {
            ...current,
            activeShift: null,
            shifts: updatedShifts,
          };
        }
      },
      { revalidate: true }
    );
  }, [mutate]);

  return {
    dashboardData: data,
    employeeProfile: data?.employee,
    assignedSite: data?.jobSite,
    shifts: data?.shifts || [],
    activeShift: data?.activeShift || null,
    isLoading: isLoading && !data,
    isValidating,
    hasCachedData: Boolean(data),
    error: error ? (error as Error).message : null,
    applyConfirmedShift,
    refreshDashboard: mutate,
  };
}

/**
 * Hook: Archived & Voided Records Ledger
 * Lazily loaded when Ateeb navigates to the Archived Records area
 */
export function useArchivedRecords(token: string, enabled: boolean) {
  const swrKey = token && enabled ? `admin-archived-records-${token.slice(-12)}` : null;

  const { data, error, isLoading, isValidating, mutate } = useSWR<ArchivedRecordsData>(
    swrKey,
    async () => {
      const res = await getArchivedRecords(token);
      if (!res.success || !res.data) {
        throw new Error(res.message || 'Failed to retrieve archived records.');
      }
      return res.data;
    },
    {
      revalidateOnFocus: false,
      dedupingInterval: 10000,
      keepPreviousData: true,
      shouldRetryOnError: true,
    }
  );

  return {
    archivedData: data,
    archivedEmployees: data?.archivedEmployees || [],
    archivedJobSites: data?.archivedJobSites || [],
    voidedShifts: data?.voidedShifts || [],
    voidedOvertime: data?.voidedOvertime || [],
    duplicates: data?.duplicates || [],
    counts: data?.counts || {
      archivedEmployees: 0,
      archivedJobSites: 0,
      voidedShifts: 0,
      voidedOvertime: 0,
      duplicates: 0,
    },
    isLoading: isLoading && !data,
    isValidating,
    error: error ? (error as Error).message : null,
    refreshArchivedRecords: mutate,
  };
}

