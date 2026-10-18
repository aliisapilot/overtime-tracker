import React, { useState, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import {
  UserSession,
  JobSite,
  EmployeeProfile,
  createEmployee,
  updateEmployee,
  approveOvertime,
  archiveEmployee,
  restoreEmployee,
  archiveJobSite,
  restoreJobSite,
  voidShift,
  voidOvertime,
  purgeAttendancePhoto,
  purgePhotoFromStorage,
  ArchivedEmployee,
  ArchivedJobSite,
  VoidedShift,
  VoidedOvertime,
  DuplicateRecord,
} from '@/lib/api';
import ChangePinModal from '@/components/ChangePinModal';
import ConfirmDeleteModal, { DeleteActionType } from '@/components/ConfirmDeleteModal';
import { getEmployeeDisplayId, getJobSiteDisplayId } from '@/lib/displayId';
import {
  useAdminDashboard,
  useAdminAttendance,
  useAdminAuditLogs,
  useDailyReport,
  useArchivedRecords,
} from '@/lib/useDataLayer';

const JobSiteModal = dynamic(() => import('@/components/JobSiteModal'), { ssr: false });
const PhotoModal = dynamic(() => import('@/components/PhotoModal'), { ssr: false });

interface DailyReportData {
  date: string;
  totalActiveEmployees: number;
  totalShifts: number;
  completedShifts: number;
  activeShifts: number;
  totalRegularHours: number;
  totalOvertimeHours: number;
  bySite: Record<string, { siteName: string; shifts: number; regularHours: number; overtimeHours: number }>;
  byEmployee: Record<string, { employeeName: string; shifts: number; regularHours: number; overtimeHours: number }>;
}

interface AdminDashboardProps {
  session: UserSession;
  onLogout: () => void;
}

interface OvertimeItem {
  ID: string;
  'Shift ID': string;
  'Employee ID': string;
  Date: string;
  'Overtime Hours': number;
  'Approval Status': string;
  'Approved By': string;
}

interface AttendanceItem {
  ID?: string;
  shiftId?: string;
  'Employee ID'?: string;
  employeeId?: string;
  employeeName?: string;
  'Site ID'?: string;
  siteId?: string;
  siteName?: string;
  'Start Time'?: string;
  startTime?: string;
  'End Time'?: string;
  endTime?: string;
  'Start Latitude'?: number;
  'Start Longitude'?: number;
  startLat?: number;
  startLon?: number;
  startAccuracy?: number;
  'Start Accuracy'?: number;
  'End Latitude'?: number;
  'End Longitude'?: number;
  endLat?: number;
  endLon?: number;
  endAccuracy?: number;
  'End Accuracy'?: number;
  'Break Minutes'?: number;
  breakMinutes?: number;
  'Regular Hours'?: number;
  regularHours?: number;
  'Overtime Hours'?: number;
  overtimeHours?: number;
  Status?: string;
  status?: string;
  startPhotoKey?: string;
  startPhotoCapturedAt?: string;
  startPhotoStatus?: string;
  endPhotoKey?: string;
  endPhotoCapturedAt?: string;
  endPhotoStatus?: string;
}

interface AuditLogItem {
  ID: string;
  'Employee ID': string;
  Action: string;
  Outcome: string;
  Timestamp: string;
  'Performed By': string;
  Details: string;
}

function formatDuration(startStr?: string, endStr?: string): string {
  if (!startStr) return '—';
  const start = new Date(startStr).getTime();
  const end = endStr ? new Date(endStr).getTime() : Date.now();
  if (isNaN(start) || isNaN(end) || end < start) return '—';
  const diffMinutes = Math.floor((end - start) / 60000);
  const hours = Math.floor(diffMinutes / 60);
  const mins = diffMinutes % 60;
  return `${hours}h ${mins}m${!endStr ? ' (active)' : ''}`;
}

export default function AdminDashboard({ session, onLogout }: AdminDashboardProps) {
  const [activeTab, setActiveTab] = useState<'overtime' | 'attendance' | 'reports' | 'employees' | 'sites' | 'audit' | 'archived'>('overtime');
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isManualSyncing, setIsManualSyncing] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null);

  // Auto-dismiss ordinary success notifications after ~3 seconds (keep error notifications visible)
  useEffect(() => {
    if (actionMessage && actionMessage.type === 'success') {
      const timer = setTimeout(() => {
        setActionMessage(null);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [actionMessage]);

  // Modal error states (displayed directly inside modals if operations fail)
  const [deleteModalError, setDeleteModalError] = useState<string | null>(null);
  const [addEmpModalError, setAddEmpModalError] = useState<string | null>(null);
  const [editEmpModalError, setEditEmpModalError] = useState<string | null>(null);

  // Confirm delete/archive/void modal state
  const [deleteModalState, setDeleteModalState] = useState<{
    isOpen: boolean;
    actionType: DeleteActionType;
    recordId: string;
    recordTitle: string;
    subtitle?: string;
    shiftPhotoType?: 'start' | 'end';
  } | null>(null);
  const [isSubmittingDelete, setIsSubmittingDelete] = useState(false);

  // Archived Records tab filters
  const [archivedSubTab, setArchivedSubTab] = useState<'all' | 'employees' | 'sites' | 'shifts' | 'overtime' | 'duplicates'>('all');
  const [archivedSearchQuery, setArchivedSearchQuery] = useState('');

  // Photo viewer modal state
  const [previewPhoto, setPreviewPhoto] = useState<{
    key: string;
    title: string;
    shiftId?: string;
    employeeName?: string;
    employeeId?: string;
    timestamp?: string;
    lat?: number | null;
    lon?: number | null;
    accuracy?: number | null;
    status?: string;
  } | null>(null);

  // Reports state
  const [reportDate, setReportDate] = useState(() => new Date().toISOString().split('T')[0]);

  // Centralized SWR Data Layer
  const {
    employees,
    jobSites,
    pendingOvertime: rawPendingOvertime,
    activeShiftsCount,
    todayShiftsCount,
    totalEmployeesCount,
    archivedCount: rawArchivedCount,
    isLoading: isDashboardLoading,
    isValidating: isDashboardValidating,
    hasCachedData,
    error: dashboardError,
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
  } = useAdminDashboard(session.token);

  const overtimeList = (rawPendingOvertime || []) as OvertimeItem[];

  const {
    attendance: rawAttendance,
    isLoading: attendanceLoading,
    isValidating: attendanceValidating,
    error: attendanceError,
    refreshAttendance,
    voidShiftLocally,
  } = useAdminAttendance(session.token);

  const attendanceList = (rawAttendance || []) as AttendanceItem[];

  const {
    archivedEmployees,
    archivedJobSites,
    voidedShifts,
    voidedOvertime,
    duplicates,
    counts: archivedCounts,
    isLoading: archivedLoading,
    refreshArchivedRecords,
  } = useArchivedRecords(session.token, activeTab === 'archived');

  const {
    auditLogs: rawAuditLogs,
    isLoading: auditLoading,
  } = useAdminAuditLogs(session.token, activeTab === 'audit');

  const auditLogs = (rawAuditLogs || []) as AuditLogItem[];

  const {
    report: dailyReportData,
    isLoading: loadingReport,
  } = useDailyReport(session.token, reportDate);

  const dailyReport = dailyReportData as DailyReportData | null;

  // Modals state
  const [showAddEmpModal, setShowAddEmpModal] = useState(false);
  const [submittingModal, setSubmittingModal] = useState(false);
  const [showPinModal, setShowPinModal] = useState(false);
  const [showSiteModal, setShowSiteModal] = useState(false);
  const [selectedSiteToEdit, setSelectedSiteToEdit] = useState<JobSite | null>(null);

  // New Employee Form
  const [newEmpCustomId, setNewEmpCustomId] = useState('');
  const [newEmpName, setNewEmpName] = useState('');
  const [newEmpPhone, setNewEmpPhone] = useState('');
  const [newEmpPin, setNewEmpPin] = useState('');
  const [newEmpSiteId, setNewEmpSiteId] = useState('');

  // Helper getters for JobSite properties across casing variations
  const getSiteId = (s: JobSite) => s.id || s.ID || '';
  const getSiteName = (s: JobSite) => s.name || s.Name || getSiteId(s);

  // Edit Employee Form
  const [editingEmp, setEditingEmp] = useState<EmployeeProfile | null>(null);
  const [editEmpId, setEditEmpId] = useState('');
  const [editEmpName, setEditEmpName] = useState('');
  const [editEmpPhone, setEditEmpPhone] = useState('');
  const [editEmpSiteId, setEditEmpSiteId] = useState('');
  const [editEmpStatus, setEditEmpStatus] = useState('Active');
  const [editEmpPin, setEditEmpPin] = useState('');

  const handleOpenEditEmp = (emp: EmployeeProfile) => {
    setEditingEmp(emp);
    setEditEmpId(emp.id);
    setEditEmpName(emp.name);
    setEditEmpPhone(emp.phone || '');
    setEditEmpSiteId(emp.siteId || '');
    setEditEmpStatus(emp.status || 'Active');
    setEditEmpPin('');
    setEditEmpModalError(null);
  };

  const handleUpdateEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingEmp) return;
    if (!editEmpName.trim() || !editEmpId.trim()) {
      setEditEmpModalError('Employee ID and Name are required');
      return;
    }
    setSubmittingModal(true);
    setEditEmpModalError(null);
    try {
      const res = await updateEmployee(session.token, {
        currentId: editingEmp.id,
        newId: editEmpId.trim().toUpperCase(),
        name: editEmpName.trim(),
        phone: editEmpPhone.trim(),
        siteId: editEmpSiteId.trim(),
        status: editEmpStatus,
        pin: editEmpPin.trim() || undefined,
      });
      if (res.success) {
        const confirmed = res.employee || {
          id: editEmpId.trim().toUpperCase(),
          name: editEmpName.trim(),
          phone: editEmpPhone.trim(),
          role: editingEmp.role || 'Labourer',
          siteId: editEmpSiteId.trim(),
          status: editEmpStatus,
        };
        updateEmployeeLocally(confirmed as EmployeeProfile);
        const displayId = getEmployeeDisplayId(editEmpId.trim(), employees);
        setActionMessage({
          type: 'success',
          text: `Employee ${editEmpName} updated successfully (${displayId})!`,
        });
        setEditingEmp(null);
        setEditEmpModalError(null);
      } else {
        const errMsg = res.message || 'Failed to update employee';
        setEditEmpModalError(errMsg);
        setActionMessage({ type: 'error', text: errMsg });
      }
    } catch (err: unknown) {
      const errMsg = (err as Error).message || 'Failed to update employee';
      setEditEmpModalError(errMsg);
      setActionMessage({ type: 'error', text: errMsg });
    } finally {
      setSubmittingModal(false);
    }
  };

  const handleCreateEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmpName.trim() || !newEmpPin.trim()) {
      setAddEmpModalError('Employee Name and PIN are required');
      return;
    }
    setSubmittingModal(true);
    setAddEmpModalError(null);
    try {
      const res = await createEmployee(session.token, {
        employeeId: newEmpCustomId.trim().toUpperCase() || undefined,
        name: newEmpName.trim(),
        phone: newEmpPhone.trim(),
        role: 'Labourer',
        siteId: newEmpSiteId.trim() || undefined,
        pin: newEmpPin.trim(),
      });
      if (res.success) {
        const assignedId = (res as { employeeId?: string; employee?: { id: string } }).employeeId || (res as { employee?: { id: string } }).employee?.id || 'Registered';
        const confirmed = (res as { employee?: Partial<EmployeeProfile> }).employee;
        const newEmpObj: EmployeeProfile = {
          id: assignedId,
          name: confirmed?.name || newEmpName.trim(),
          phone: confirmed?.phone || newEmpPhone.trim(),
          role: 'Labourer',
          siteId: confirmed?.siteId || newEmpSiteId.trim(),
          status: confirmed?.status || 'Active',
          displayId: confirmed?.displayId || getEmployeeDisplayId(assignedId, employees),
        };
        addEmployeeLocally(newEmpObj);
        const displayId = newEmpObj.displayId || getEmployeeDisplayId(assignedId, employees);
        const siteName = newEmpSiteId ? (jobSites.find(s => getSiteId(s) === newEmpSiteId.trim())?.name || getJobSiteDisplayId(newEmpSiteId.trim(), jobSites)) : '';
        setActionMessage({
          type: 'success',
          text: `Labourer ${newEmpName} registered successfully! Assigned ID: ${displayId}${siteName ? ` (Assigned to ${siteName})` : ''}`,
        });
        setShowAddEmpModal(false);
        setAddEmpModalError(null);
        setNewEmpCustomId('');
        setNewEmpName('');
        setNewEmpPhone('');
        setNewEmpPin('');
        setNewEmpSiteId('');
      } else {
        const errMsg = res.message || 'Failed to create employee';
        setAddEmpModalError(errMsg);
        setActionMessage({ type: 'error', text: errMsg });
      }
    } catch (err: unknown) {
      const errMsg = (err as Error).message || 'Failed to create employee';
      setAddEmpModalError(errMsg);
      setActionMessage({ type: 'error', text: errMsg });
    } finally {
      setSubmittingModal(false);
    }
  };

  const handleExportCsv = () => {
    if (attendanceList.length === 0) return;
    const headers = [
      'Shift ID',
      'Employee ID',
      'Employee Name',
      'Job Site',
      'Clock In Time',
      'Clock In Lat',
      'Clock In Lon',
      'Clock In Accuracy (m)',
      'Clock In Photo Status',
      'Clock In Maps URL',
      'Clock Out Time',
      'Clock Out Lat',
      'Clock Out Lon',
      'Clock Out Accuracy (m)',
      'Clock Out Photo Status',
      'Clock Out Maps URL',
      'Regular Hours',
      'Overtime Hours',
      'Status'
    ];
    const rows = attendanceList.map((att) => {
      const sLat = att.startLat ?? att['Start Latitude'] ?? '';
      const sLon = att.startLon ?? att['Start Longitude'] ?? '';
      const sAcc = att.startAccuracy ?? att['Start Accuracy'] ?? '';
      const eLat = att.endLat ?? att['End Latitude'] ?? '';
      const eLon = att.endLon ?? att['End Longitude'] ?? '';
      const eAcc = att.endAccuracy ?? att['End Accuracy'] ?? '';
      const sUrl = sLat !== '' && sLon !== '' ? `https://www.google.com/maps?q=${sLat},${sLon}` : '';
      const eUrl = eLat !== '' && eLon !== '' ? `https://www.google.com/maps?q=${eLat},${eLon}` : '';
      const empId = att['Employee ID'] || att.employeeId || '';
      const empName = att.employeeName || employees.find((e) => e.id === empId)?.name || 'Unknown';
      const siteName = att.siteName || jobSites.find((s) => getSiteId(s) === (att['Site ID'] || att.siteId))?.name || att['Site ID'] || att.siteId || 'Unassigned';

      return [
        att.ID || att.shiftId || '',
        empId,
        `"${empName.replace(/"/g, '""')}"`,
        `"${siteName.replace(/"/g, '""')}"`,
        att['Start Time'] || att.startTime || '',
        sLat,
        sLon,
        sAcc,
        att.startPhotoStatus || (att.startPhotoKey ? 'Verified' : 'Legacy Record'),
        sUrl ? `"${sUrl}"` : '',
        att['End Time'] || att.endTime || '',
        eLat,
        eLon,
        eAcc,
        att.endPhotoStatus || (att.endPhotoKey ? 'Verified' : (att['End Time'] || att.endTime ? 'Legacy Record' : 'Pending')),
        eUrl ? `"${eUrl}"` : '',
        att['Regular Hours'] || att.regularHours || 0,
        att['Overtime Hours'] || att.overtimeHours || 0,
        att.Status || att.status || '',
      ];
    });

    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `attendance_with_gps_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleGenerateReport = (dateStr?: string) => {
    if (dateStr) {
      setReportDate(dateStr);
    }
  };

  const handleExportReportCsv = () => {
    if (!dailyReport) return;
    const lines: string[] = [];
    lines.push(`DAILY ATTENDANCE & OVERTIME REPORT,Date: ${dailyReport.date}`);
    lines.push(`Generated At,${new Date().toLocaleString()}`);
    lines.push('');
    lines.push('METRIC,VALUE');
    lines.push(`Total Shifts,${dailyReport.totalShifts}`);
    lines.push(`Completed Shifts,${dailyReport.completedShifts}`);
    lines.push(`Active Shifts,${dailyReport.activeShifts}`);
    lines.push(`Total Regular Hours,${dailyReport.totalRegularHours}`);
    lines.push(`Total Overtime Hours,${dailyReport.totalOvertimeHours}`);
    lines.push(`Active Workforce,${dailyReport.totalActiveEmployees}`);
    lines.push('');
    lines.push('BREAKDOWN BY JOB SITE');
    lines.push('Site ID,Site Name,Shifts,Regular Hours,Overtime Hours,Total Hours');
    Object.entries(dailyReport.bySite).forEach(([siteId, data]) => {
      lines.push(
        `${siteId},"${data.siteName.replace(/"/g, '""')}",${data.shifts},${data.regularHours.toFixed(1)},${data.overtimeHours.toFixed(1)},${(data.regularHours + data.overtimeHours).toFixed(1)}`
      );
    });
    lines.push('');
    lines.push('BREAKDOWN BY EMPLOYEE');
    lines.push('Employee ID,Employee Name,Shifts,Regular Hours,Overtime Hours,Total Hours');
    Object.entries(dailyReport.byEmployee).forEach(([empId, data]) => {
      lines.push(
        `${empId},"${data.employeeName.replace(/"/g, '""')}",${data.shifts},${data.regularHours.toFixed(1)},${data.overtimeHours.toFixed(1)},${(data.regularHours + data.overtimeHours).toFixed(1)}`
      );
    });

    const csvContent = 'data:text/csv;charset=utf-8,' + lines.join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `daily_report_${dailyReport.date}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleRefresh = async () => {
    setIsManualSyncing(true);
    setSyncFeedback(null);
    try {
      const [res] = await Promise.all([syncNow(), refreshAttendance()]);
      if (res && !res.success) {
        setActionMessage({ type: 'error', text: res.message || 'Sync failed. Retrying in background.' });
      } else {
        setSyncFeedback('Synced ✓');
        setTimeout(() => setSyncFeedback(null), 2500);
      }
    } catch (e: unknown) {
      setActionMessage({ type: 'error', text: (e as Error).message || 'Sync encountered network timeout.' });
    } finally {
      setIsManualSyncing(false);
    }
  };

  const handleApproveOvertime = async (otId: string) => {
    try {
      const res = await approveOvertime(session.token, otId);
      if (res.success) {
        approveOvertimeLocally(otId);
        setActionMessage({ type: 'success', text: `Overtime record ${otId} approved successfully!` });
      } else {
        setActionMessage({ type: 'error', text: res.message || 'Failed to approve overtime' });
      }
    } catch (err: unknown) {
      setActionMessage({ type: 'error', text: (err as Error).message });
    }
  };

  // Format UAE Date & Time (GST / Asia/Dubai)
  const formatUaeDateTime = (isoString?: string): string => {
    if (!isoString) return '—';
    try {
      const date = new Date(isoString);
      if (isNaN(date.getTime())) return isoString;
      return (
        date.toLocaleString('en-GB', {
          timeZone: 'Asia/Dubai',
          day: '2-digit',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          hour12: true,
        }) + ' GST'
      );
    } catch {
      return isoString;
    }
  };

  // Execution handler for confirm delete / archive / void / restore modal
  const handleExecuteConfirmAction = async (reason: string, policyAck?: boolean) => {
    if (!deleteModalState) return;
    setIsSubmittingDelete(true);
    setDeleteModalError(null);
    const { actionType, recordId, recordTitle, shiftPhotoType } = deleteModalState;
    try {
      let res: any;
      if (actionType === 'archive_employee') {
        res = await archiveEmployee(session.token, recordId, reason);
        if (res.success) {
          archiveEmployeeLocally(recordId);
          const dispId = getEmployeeDisplayId(recordId, employees);
          setActionMessage({
            type: 'success',
            text: `Employee ${recordTitle} (${dispId}) archived successfully. Historical attendance & overtime preserved.`,
          });
          refreshArchivedRecords();
        }
      } else if (actionType === 'restore_employee') {
        res = await restoreEmployee(session.token, recordId);
        if (res.success) {
          const empObj = employees.find((e) => e.id === recordId) || {
            id: recordId,
            name: recordTitle,
            role: 'Labourer' as const,
            status: 'Active',
          };
          restoreEmployeeLocally(empObj as EmployeeProfile);
          const dispId = getEmployeeDisplayId(recordId, employees);
          setActionMessage({
            type: 'success',
            text: `Employee ${recordTitle} (${dispId}) restored to Active status!`,
          });
          refreshArchivedRecords();
        }
      } else if (actionType === 'archive_site') {
        res = await archiveJobSite(session.token, recordId, reason);
        if (res.success) {
          archiveJobSiteLocally(recordId);
          const dispSiteId = getJobSiteDisplayId(recordId, jobSites);
          setActionMessage({
            type: 'success',
            text: `Job site ${recordTitle} (${dispSiteId}) archived successfully.`,
          });
          refreshArchivedRecords();
        }
      } else if (actionType === 'restore_site') {
        res = await restoreJobSite(session.token, recordId);
        if (res.success) {
          const siteObj = jobSites.find((s) => (s.id || s.ID) === recordId) || {
            id: recordId,
            name: recordTitle,
            status: 'Active',
          };
          restoreJobSiteLocally(siteObj as JobSite);
          const dispSiteId = getJobSiteDisplayId(recordId, jobSites);
          setActionMessage({
            type: 'success',
            text: `Job site ${recordTitle} (${dispSiteId}) restored to Active status!`,
          });
          refreshArchivedRecords();
        }
      } else if (actionType === 'void_shift') {
        res = await voidShift(session.token, recordId, reason);
        if (res.success) {
          voidShiftLocally(recordId);
          setActionMessage({
            type: 'success',
            text: `Shift ${recordId} voided successfully and excluded from active hours.`,
          });
          refreshArchivedRecords();
        }
      } else if (actionType === 'void_overtime') {
        res = await voidOvertime(session.token, recordId, reason);
        if (res.success) {
          voidOvertimeLocally(recordId);
          setActionMessage({
            type: 'success',
            text: `Overtime record ${recordId} cancelled successfully.`,
          });
          refreshArchivedRecords();
        }
      } else if (actionType === 'purge_photo') {
        res = await purgeAttendancePhoto(session.token, recordId, shiftPhotoType || 'start', reason, policyAck);
        if (res.success) {
          if (res.photoKey) {
            await purgePhotoFromStorage(session.token, res.photoKey, reason);
          }
          refreshAttendance();
          setActionMessage({
            type: 'success',
            text: `Attendance photo purged permanently under retention policy. Shift record preserved.`,
          });
        }
      }

      if (res && !res.success) {
        const errMsg = res.message || 'Operation failed.';
        setDeleteModalError(errMsg);
        setActionMessage({ type: 'error', text: errMsg });
      } else {
        setDeleteModalError(null);
        setDeleteModalState(null);
      }
    } catch (err: unknown) {
      const errMsg = (err as Error).message || 'An unexpected error occurred';
      setDeleteModalError(errMsg);
      setActionMessage({ type: 'error', text: errMsg });
    } finally {
      setIsSubmittingDelete(false);
    }
  };

  return (
    <div className="flex-1 max-w-6xl w-full mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
      {/* Admin Header */}
      <header className="glass-panel rounded-3xl p-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border border-blue-500/20">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center text-white font-black text-xl shadow-lg shadow-blue-500/25">
              🛡️
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-white">Administrator Portal</h1>
              <p className="text-xs sm:text-sm text-slate-400">
                Logged in as <span className="font-semibold text-white">{session.employee.name}</span> (ID:{' '}
                <span className="font-mono text-blue-400">{session.employee.id}</span>)
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {(isDashboardValidating || attendanceValidating) && !isManualSyncing && (
            <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/20">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-ping" />
              Syncing...
            </span>
          )}
          <button
            onClick={() => setShowPinModal(true)}
            className="px-3.5 py-2 text-xs font-semibold uppercase tracking-wider text-slate-300 hover:text-white bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 rounded-xl transition-all cursor-pointer"
          >
            Change PIN
          </button>
          <button
            onClick={handleRefresh}
            disabled={isManualSyncing}
            className="px-4 py-2 text-xs font-semibold uppercase tracking-wider text-blue-400 hover:text-blue-300 bg-blue-950/40 hover:bg-blue-900/50 border border-blue-800/60 rounded-xl transition-all cursor-pointer flex items-center gap-1.5"
          >
            <span className={isManualSyncing ? 'animate-spin' : ''}>↻</span>
            <span>{isManualSyncing ? 'Syncing...' : syncFeedback || 'Sync Data'}</span>
          </button>
          <button
            onClick={onLogout}
            className="px-4 py-2 text-xs font-semibold uppercase tracking-wider text-slate-300 hover:text-white bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 rounded-xl transition-all cursor-pointer"
          >
            Sign Out
          </button>
        </div>
      </header>

      {/* Action Notification Banner */}
      {actionMessage && (
        <div
          className={`p-4 rounded-2xl text-sm flex items-start gap-3 border ${
            actionMessage.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
              : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
          }`}
        >
          <span className="text-lg">{actionMessage.type === 'success' ? '✓' : '⚠️'}</span>
          <div className="flex-1 font-medium">{actionMessage.text}</div>
          <button onClick={() => setActionMessage(null)} className="text-xs uppercase opacity-70 hover:opacity-100">
            Dismiss
          </button>
        </div>
      )}

      {/* Backend Error Notice Banner */}
      {dashboardError && !hasCachedData && (
        <div className="p-4 rounded-2xl text-sm flex items-start justify-between gap-3 border bg-rose-500/10 border-rose-500/30 text-rose-300">
          <div className="flex items-start gap-2.5">
            <span className="text-lg">⚠️</span>
            <div>
              <p className="font-bold">Backend Connection Notice</p>
              <p className="text-xs text-rose-200/90 mt-0.5">{dashboardError}</p>
            </div>
          </div>
          <button
            onClick={handleRefresh}
            className="px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-semibold whitespace-nowrap cursor-pointer transition-all shadow-sm"
          >
            Retry Sync
          </button>
        </div>
      )}

      {/* Overview Stat Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
        <div className="glass-card rounded-2xl p-4">
          <span className="text-xs font-medium text-slate-400 block mb-1">Active Workforce</span>
          <span className="text-2xl font-bold text-white font-mono">
            {hasCachedData ? totalEmployeesCount : isDashboardLoading ? '…' : dashboardError ? '—' : 0}
          </span>
        </div>
        <div className="glass-card rounded-2xl p-4 border-emerald-500/20 bg-emerald-500/5">
          <span className="text-xs font-medium text-emerald-400 block mb-1">Clocked-In Now</span>
          <span className="text-2xl font-bold text-emerald-300 font-mono">
            {activeShiftsCount != null
              ? activeShiftsCount
              : !attendanceLoading
              ? attendanceList.filter((a) => (a.Status || a.status) === 'Active' || !(a['End Time'] || a.endTime)).length
              : hasCachedData ? 0 : '…'}
          </span>
        </div>
        <div className="glass-card rounded-2xl p-4 border-amber-500/30 bg-amber-500/5">
          <span className="text-xs font-medium text-amber-400 block mb-1">Pending Overtime</span>
          <span className="text-2xl font-bold text-amber-300 font-mono">
            {hasCachedData ? overtimeList.length : isDashboardLoading ? '…' : dashboardError ? '—' : 0}
          </span>
        </div>
        <div className="glass-card rounded-2xl p-4">
          <span className="text-xs font-medium text-slate-400 block mb-1">Today's Shifts</span>
          <span className="text-2xl font-bold text-blue-400 font-mono">
            {todayShiftsCount != null
              ? todayShiftsCount
              : !attendanceLoading
              ? attendanceList.length
              : hasCachedData ? 0 : '…'}
          </span>
        </div>
        <div
          onClick={() => setActiveTab('archived')}
          className="glass-card rounded-2xl p-4 border-amber-500/20 bg-amber-500/5 hover:border-amber-500/40 cursor-pointer transition-all"
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium text-amber-400">Archived Records</span>
            <span className="text-[10px] text-amber-300 font-mono">Safe</span>
          </div>
          <span className="text-2xl font-bold text-amber-300 font-mono">
            {(archivedCounts.archivedEmployees + archivedCounts.archivedJobSites + archivedCounts.voidedShifts + archivedCounts.voidedOvertime) || 0}
          </span>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex border-b border-slate-800 space-x-1 sm:space-x-2 overflow-x-auto pb-1">
        {[
          { id: 'overtime', label: `Pending Overtime (${overtimeList.length})` },
          { id: 'attendance', label: 'Attendance & GPS Locations' },
          { id: 'reports', label: 'Daily Reports' },
          { id: 'employees', label: `Employees (${employees.filter(e => e.status !== 'Archived').length})` },
          { id: 'sites', label: `Job Sites (${jobSites.filter(s => (s.status || s.Status) !== 'Archived').length})` },
          { id: 'archived', label: `Archived Records (${archivedCounts.archivedEmployees + archivedCounts.archivedJobSites})` },
          { id: 'audit', label: 'Audit Logs' },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as typeof activeTab)}
            className={`py-2.5 px-4 rounded-xl text-xs sm:text-sm font-semibold transition-all whitespace-nowrap cursor-pointer ${
              activeTab === tab.id
                ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Main Content Area */}
      <main className="glass-panel rounded-3xl p-6 min-h-[350px]">
        {isDashboardLoading ? (
          <div className="py-12 flex flex-col items-center justify-center text-slate-400 space-y-3">
            <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm">Fetching real records from Google Sheets...</p>
          </div>
        ) : (
          <>
            {/* 1. OVERTIME TAB */}
            {activeTab === 'overtime' && (
              <div>
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">
                    Pending Overtime Authorization
                  </h2>
                  <span className="text-xs text-slate-400">All approvals are logged to the permanent audit trail</span>
                </div>
                {overtimeList.length === 0 ? (
                  <p className="text-sm text-slate-500 py-8 text-center">No pending overtime requests awaiting approval.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs text-slate-300">
                      <thead className="text-[10px] uppercase tracking-wider text-slate-400 border-b border-slate-700/80">
                        <tr>
                          <th className="py-2.5 pr-4">OT ID</th>
                          <th className="py-2.5 pr-4">Employee ID</th>
                          <th className="py-2.5 pr-4">Date</th>
                          <th className="py-2.5 pr-4">Overtime Hours</th>
                          <th className="py-2.5 pr-4">Status</th>
                          <th className="py-2.5">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800">
                        {overtimeList.map((ot) => {
                          const otEmpDisp = getEmployeeDisplayId(ot['Employee ID'], employees);
                          return (
                          <tr key={ot.ID} className="hover:bg-slate-800/30">
                            <td className="py-3 pr-4 font-mono text-slate-400 text-xs">{ot.ID}</td>
                            <td className="py-3 pr-4 font-mono font-medium text-white">
                              <span title={ot['Employee ID'] !== otEmpDisp ? `Internal ID: ${ot['Employee ID']}` : undefined}>
                                {otEmpDisp}
                              </span>
                            </td>
                            <td className="py-3 pr-4 font-mono">{ot.Date}</td>
                            <td className="py-3 pr-4 font-mono font-bold text-blue-400 text-sm">
                              {ot['Overtime Hours']} hrs
                            </td>
                            <td className="py-3 pr-4">
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                                {ot['Approval Status']}
                              </span>
                            </td>
                            <td className="py-3">
                              <div className="flex items-center gap-1.5">
                                <button
                                  onClick={() => handleApproveOvertime(ot.ID)}
                                  className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold transition-all cursor-pointer"
                                >
                                  Approve
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setDeleteModalState({
                                      isOpen: true,
                                      actionType: 'void_overtime',
                                      recordId: ot.ID,
                                      recordTitle: `Overtime for ${ot['Employee ID']} (${ot['Overtime Hours']} hrs)`,
                                      subtitle: `Date: ${ot.Date}`,
                                    })
                                  }
                                  className="px-2.5 py-1 bg-rose-600/10 hover:bg-rose-600 text-rose-400 hover:text-white border border-rose-500/20 rounded-lg text-xs font-semibold transition-all cursor-pointer"
                                >
                                  Cancel / Void
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* 2. ATTENDANCE TAB */}
            {activeTab === 'attendance' && (
              <div>
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4">
                  <div>
                    <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">
                      Attendance & Shift Ledger
                    </h2>
                    <p className="text-xs text-slate-400">
                      Verified clock-in and clock-out timestamps, mandatory selfies, and high-accuracy GPS coordinates
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => refreshAttendance()}
                      disabled={attendanceLoading}
                      className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      <span className={attendanceLoading ? 'animate-spin' : ''}>↻</span>
                      <span>Refresh</span>
                    </button>
                    {attendanceList.length > 0 && (
                      <button
                        onClick={handleExportCsv}
                        className="px-3.5 py-1.5 rounded-xl bg-blue-950/40 hover:bg-blue-900/50 text-blue-400 hover:text-blue-300 border border-blue-800/60 text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer shadow-sm"
                      >
                        <span>📥</span>
                        <span>Export CSV with GPS</span>
                      </button>
                    )}
                  </div>
                </div>

                {attendanceLoading ? (
                  <div className="py-12 flex flex-col items-center justify-center text-slate-400 space-y-3">
                    <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                    <p className="text-xs">Loading attendance ledger from Google Sheets...</p>
                  </div>
                ) : attendanceError ? (
                  <div className="p-6 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-center space-y-3">
                    <p className="text-sm font-semibold text-rose-300">Connection Error Loading Attendance</p>
                    <p className="text-xs text-rose-200/80">{attendanceError}</p>
                    <button
                      onClick={() => refreshAttendance()}
                      className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-semibold cursor-pointer transition-all shadow-sm"
                    >
                      Retry Loading Attendance
                    </button>
                  </div>
                ) : attendanceList.length === 0 ? (
                  <p className="text-sm text-slate-500 py-8 text-center">No attendance shifts recorded for today yet.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs text-slate-300">
                      <thead className="text-[10px] uppercase tracking-wider text-slate-400 border-b border-slate-700/80">
                        <tr>
                          <th className="py-2.5 pr-3">Employee</th>
                          <th className="py-2.5 pr-3">Job Site</th>
                          <th className="py-2.5 pr-3">Clock In (Time, Selfie & GPS)</th>
                          <th className="py-2.5 pr-3">Clock Out (Time, Selfie & GPS)</th>
                          <th className="py-2.5 pr-3">Duration</th>
                          <th className="py-2.5 pr-3">Hours (Reg / OT)</th>
                          <th className="py-2.5 pr-3">Status</th>
                          <th className="py-2.5 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800">
                        {attendanceList.map((att) => {
                          const sLat = att.startLat ?? att['Start Latitude'];
                          const sLon = att.startLon ?? att['Start Longitude'];
                          const sAcc = att.startAccuracy ?? att['Start Accuracy'];
                          const eLat = att.endLat ?? att['End Latitude'];
                          const eLon = att.endLon ?? att['End Longitude'];
                          const eAcc = att.endAccuracy ?? att['End Accuracy'];
                          const empId = att['Employee ID'] || att.employeeId || '—';
                          const empDisp = getEmployeeDisplayId(empId, employees);
                          const empName = att.employeeName || employees.find((e) => e.id === empId)?.name || 'Labourer';
                          const siteId = att['Site ID'] || att.siteId || '';
                          const siteDisp = getJobSiteDisplayId(siteId, jobSites);
                          const siteName = att.siteName || jobSites.find((s) => getSiteId(s) === siteId)?.name || siteId || 'Unassigned';
                          const durationStr = formatDuration(att['Start Time'] || att.startTime, att['End Time'] || att.endTime);

                          return (
                            <tr key={att.ID || att.shiftId} className="hover:bg-slate-800/30">
                              {/* Employee Name & ID */}
                              <td className="py-3 pr-3 w-40 max-w-[160px]">
                                <div className="font-semibold text-white truncate" title={empName}>{empName}</div>
                                <div className="text-[11px] font-mono text-blue-400" title={empId !== empDisp ? `Internal ID: ${empId}` : undefined}>{empDisp}</div>
                                {att.ID && (
                                  <div className="text-[9px] font-mono text-slate-500 truncate max-w-[100px]">
                                    #{att.ID}
                                  </div>
                                )}
                              </td>

                              {/* Job Site */}
                              <td className="py-3 pr-3 max-w-[160px]">
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-medium bg-slate-800 text-slate-300 border border-slate-700 truncate max-w-full" title={siteId ? `${siteName} (${siteId})` : siteName}>
                                  <span className="truncate">{siteName}</span>
                                  {siteDisp && <span className="text-[10px] text-slate-400 font-mono shrink-0">({siteDisp})</span>}
                                </span>
                              </td>

                              {/* Clock In */}
                              <td className="py-3 pr-3">
                                <div className="text-white font-medium">
                                  {new Date(att['Start Time'] || att.startTime || Date.now()).toLocaleTimeString([], {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  })}
                                </div>
                                <div className="flex flex-col gap-0.5 mt-1">
                                  {att.startPhotoKey ? (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setPreviewPhoto({
                                          key: att.startPhotoKey || '',
                                          title: 'Clock-in Selfie',
                                          shiftId: att.ID || att.shiftId || '',
                                          employeeName: empName,
                                          employeeId: empId,
                                          timestamp: att.startPhotoCapturedAt || att['Start Time'] || att.startTime,
                                          lat: sLat,
                                          lon: sLon,
                                          accuracy: sAcc,
                                          status: att.startPhotoStatus || 'Verified',
                                        })
                                      }
                                      className="inline-flex items-center gap-1 text-[11px] text-blue-400 hover:text-blue-300 hover:underline cursor-pointer font-medium"
                                    >
                                      <span>📸</span>
                                      <span>View Selfie</span>
                                    </button>
                                  ) : att.startPhotoStatus === 'Legacy Record' ? (
                                    <span className="text-[10px] text-slate-500 italic">Legacy Record</span>
                                  ) : null}

                                  {sLat != null && sLon != null && !isNaN(Number(sLat)) ? (
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      <a
                                        href={`https://www.google.com/maps?q=${sLat},${sLon}`}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="inline-flex items-center gap-0.5 text-[10px] font-mono text-emerald-400 hover:text-emerald-300 hover:underline"
                                      >
                                        <span>📍</span>
                                        <span>
                                          {Number(sLat).toFixed(4)}, {Number(sLon).toFixed(4)}
                                        </span>
                                        <span className="text-[8px]">↗</span>
                                      </a>
                                      {sAcc != null && (
                                        <span
                                          className={`text-[9px] px-1 py-0.2 rounded font-mono ${
                                            sAcc <= 30
                                              ? 'bg-emerald-500/10 text-emerald-400'
                                              : 'bg-amber-500/10 text-amber-400'
                                          }`}
                                        >
                                          ±{Math.round(sAcc)}m
                                        </span>
                                      )}
                                    </div>
                                  ) : (
                                    <span className="text-[10px] text-slate-500">—</span>
                                  )}
                                </div>
                              </td>

                              {/* Clock Out */}
                              <td className="py-3 pr-3">
                                {att['End Time'] || att.endTime ? (
                                  <>
                                    <div className="text-white font-medium">
                                      {new Date((att['End Time'] || att.endTime) as string).toLocaleTimeString([], {
                                        hour: '2-digit',
                                        minute: '2-digit',
                                      })}
                                    </div>
                                    <div className="flex flex-col gap-0.5 mt-1">
                                      {att.endPhotoKey ? (
                                        <button
                                          type="button"
                                          onClick={() =>
                                            setPreviewPhoto({
                                              key: att.endPhotoKey || '',
                                              title: 'Clock-out Selfie',
                                              shiftId: att.ID || att.shiftId || '',
                                              employeeName: empName,
                                              employeeId: empId,
                                              timestamp: att.endPhotoCapturedAt || att['End Time'] || att.endTime,
                                              lat: eLat,
                                              lon: eLon,
                                              accuracy: eAcc,
                                              status: att.endPhotoStatus || 'Verified',
                                            })
                                          }
                                          className="inline-flex items-center gap-1 text-[11px] text-blue-400 hover:text-blue-300 hover:underline cursor-pointer font-medium"
                                        >
                                          <span>📸</span>
                                          <span>View Selfie</span>
                                        </button>
                                      ) : att.endPhotoStatus === 'Legacy Record' ? (
                                        <span className="text-[10px] text-slate-500 italic">Legacy Record</span>
                                      ) : null}

                                      {eLat != null && eLon != null && !isNaN(Number(eLat)) ? (
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                          <a
                                            href={`https://www.google.com/maps?q=${eLat},${eLon}`}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="inline-flex items-center gap-0.5 text-[10px] font-mono text-emerald-400 hover:text-emerald-300 hover:underline"
                                          >
                                            <span>📍</span>
                                            <span>
                                              {Number(eLat).toFixed(4)}, {Number(eLon).toFixed(4)}
                                            </span>
                                            <span className="text-[8px]">↗</span>
                                          </a>
                                          {eAcc != null && (
                                            <span
                                              className={`text-[9px] px-1 py-0.2 rounded font-mono ${
                                                eAcc <= 30
                                                  ? 'bg-emerald-500/10 text-emerald-400'
                                                  : 'bg-amber-500/10 text-amber-400'
                                              }`}
                                            >
                                              ±{Math.round(eAcc)}m
                                            </span>
                                          )}
                                        </div>
                                      ) : (
                                        <span className="text-[10px] text-slate-500">—</span>
                                      )}
                                    </div>
                                  </>
                                ) : (
                                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/10 text-blue-400 border border-blue-500/20">
                                    Active On Shift
                                  </span>
                                )}
                              </td>

                              {/* Duration */}
                              <td className="py-3 pr-3 font-mono text-slate-300 text-[11px] whitespace-nowrap">
                                {durationStr}
                              </td>

                              {/* Hours (Reg / OT) */}
                              <td className="py-3 pr-3 font-mono text-[11px] whitespace-nowrap">
                                <span className="text-white">{att['Regular Hours'] || att.regularHours || 0}h</span>
                                <span className="text-slate-500 mx-1">/</span>
                                <span className="text-blue-400 font-semibold">{att['Overtime Hours'] || att.overtimeHours || 0}h</span>
                              </td>

                              {/* Status */}
                              <td className="py-3">
                                <span
                                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                    att.Status === 'Voided' || att.status === 'Voided'
                                      ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                                      : att.Status === 'Completed' || att.status === 'Completed'
                                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                      : 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                                  }`}
                                >
                                  {att.Status || att.status}
                                </span>
                              </td>

                              {/* Action */}
                              <td className="py-3 text-right">
                                {att.Status === 'Voided' || att.status === 'Voided' ? (
                                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/10 text-rose-400 border border-rose-500/20">
                                    Voided
                                  </span>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setDeleteModalState({
                                        isOpen: true,
                                        actionType: 'void_shift',
                                        recordId: att.ID || att.shiftId || '',
                                        recordTitle: `Shift: ${empName} (${att.ID || att.shiftId || 'ID'})`,
                                        subtitle: `Site: ${siteName} | Duration: ${durationStr}`,
                                      })
                                    }
                                    className="px-2.5 py-1 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 text-[11px] font-medium transition-all cursor-pointer inline-flex items-center gap-1"
                                    title="Void incorrect shift record"
                                  >
                                    <span>🗑️</span>
                                    <span>Void</span>
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* 3. DAILY REPORTS TAB */}
            {activeTab === 'reports' && (
              <div className="space-y-6">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                  <div>
                    <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">
                      Daily Attendance & Overtime Reports
                    </h2>
                    <p className="text-xs text-slate-400">
                      Aggregated shift totals, regular and overtime hours by job site and employee
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="date"
                      value={reportDate}
                      onChange={(e) => {
                        setReportDate(e.target.value);
                        handleGenerateReport(e.target.value);
                      }}
                      className="bg-slate-800 border border-slate-700 text-white rounded-xl px-3 py-1.5 text-xs font-mono focus:outline-none focus:border-blue-500"
                    />
                    <button
                      onClick={() => handleGenerateReport(reportDate)}
                      disabled={loadingReport}
                      className="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-md shadow-blue-600/30 transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      <span className={loadingReport ? 'animate-spin' : ''}>↻</span>
                      <span>{loadingReport ? 'Generating...' : 'Refresh'}</span>
                    </button>
                    {dailyReport && dailyReport.totalShifts > 0 && (
                      <button
                        onClick={handleExportReportCsv}
                        className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-blue-400 hover:text-blue-300 border border-slate-700 text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer shadow-sm"
                      >
                        <span>📥</span>
                        <span>Export CSV</span>
                      </button>
                    )}
                  </div>
                </div>

                {loadingReport ? (
                  <div className="py-12 flex flex-col items-center justify-center text-slate-400 space-y-3">
                    <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                    <p className="text-sm">Calculating aggregated report for {reportDate} from Google Sheets...</p>
                  </div>
                ) : !dailyReport ? (
                  <p className="text-sm text-slate-500 py-8 text-center">
                    Select a date and click Refresh to generate a report.
                  </p>
                ) : (
                  <div className="space-y-6">
                    {/* Summary KPI Badges */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div className="glass-card rounded-2xl p-3 border border-slate-700/60">
                        <span className="text-[11px] font-medium text-slate-400 block mb-0.5">Total Shifts</span>
                        <div className="flex items-baseline gap-2">
                          <span className="text-xl font-bold text-white font-mono">{dailyReport.totalShifts}</span>
                          <span className="text-[10px] text-slate-400">
                            ({dailyReport.completedShifts} done, {dailyReport.activeShifts} active)
                          </span>
                        </div>
                      </div>
                      <div className="glass-card rounded-2xl p-3 border border-slate-700/60">
                        <span className="text-[11px] font-medium text-slate-400 block mb-0.5">Regular Hours</span>
                        <span className="text-xl font-bold text-emerald-400 font-mono">
                          {dailyReport.totalRegularHours} hrs
                        </span>
                      </div>
                      <div className="glass-card rounded-2xl p-3 border border-amber-500/30 bg-amber-500/5">
                        <span className="text-[11px] font-medium text-amber-400 block mb-0.5">Overtime Hours</span>
                        <span className="text-xl font-bold text-amber-300 font-mono">
                          {dailyReport.totalOvertimeHours} hrs
                        </span>
                      </div>
                      <div className="glass-card rounded-2xl p-3 border border-slate-700/60">
                        <span className="text-[11px] font-medium text-slate-400 block mb-0.5">Active Workforce</span>
                        <span className="text-xl font-bold text-blue-400 font-mono">
                          {dailyReport.totalActiveEmployees}
                        </span>
                      </div>
                    </div>

                    {dailyReport.totalShifts === 0 ? (
                      <div className="p-8 rounded-2xl bg-slate-800/30 border border-slate-800 text-center">
                        <p className="text-sm text-slate-400">No shifts recorded for {dailyReport.date}.</p>
                        <p className="text-xs text-slate-500 mt-1">
                          When workers clock in or complete shifts on this date, daily summaries and site breakdowns will appear here.
                        </p>
                      </div>
                    ) : (
                      <>
                        {/* Breakdown by Job Site */}
                        <div className="space-y-3">
                          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                            Breakdown by Job Site
                          </h3>
                          <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900/40">
                            <table className="w-full text-left text-xs text-slate-300">
                              <thead className="text-[10px] uppercase tracking-wider text-slate-400 border-b border-slate-700/80 bg-slate-900/60">
                                <tr>
                                  <th className="py-2.5 px-4">Site ID</th>
                                  <th className="py-2.5 px-4">Site Name</th>
                                  <th className="py-2.5 px-4">Shifts</th>
                                  <th className="py-2.5 px-4">Regular Hrs</th>
                                  <th className="py-2.5 px-4">Overtime Hrs</th>
                                  <th className="py-2.5 px-4">Total Hrs</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-800">
                                {Object.entries(dailyReport.bySite).map(([siteId, data]) => {
                                  const siteDisp = getJobSiteDisplayId(siteId, jobSites);
                                  return (
                                  <tr key={siteId} className="hover:bg-slate-800/30">
                                    <td className="py-3 px-4 font-mono text-blue-400 font-medium w-24 whitespace-nowrap" title={siteId !== siteDisp ? `Internal ID: ${siteId}` : undefined}>{siteDisp}</td>
                                    <td className="py-3 px-4 text-white font-medium">{data.siteName}</td>
                                    <td className="py-3 px-4 font-mono">{data.shifts}</td>
                                    <td className="py-3 px-4 font-mono text-emerald-400">
                                      {data.regularHours.toFixed(1)} hrs
                                    </td>
                                    <td className="py-3 px-4 font-mono text-amber-400 font-bold">
                                      {data.overtimeHours.toFixed(1)} hrs
                                    </td>
                                    <td className="py-3 px-4 font-mono text-white font-bold">
                                      {(data.regularHours + data.overtimeHours).toFixed(1)} hrs
                                    </td>
                                  </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>

                        {/* Breakdown by Employee */}
                        <div className="space-y-3">
                          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                            Breakdown by Employee
                          </h3>
                          <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900/40">
                            <table className="w-full text-left text-xs text-slate-300">
                              <thead className="text-[10px] uppercase tracking-wider text-slate-400 border-b border-slate-700/80 bg-slate-900/60">
                                <tr>
                                  <th className="py-2.5 px-4 w-24">Employee ID</th>
                                  <th className="py-2.5 px-4">Employee Name</th>
                                  <th className="py-2.5 px-4">Shifts</th>
                                  <th className="py-2.5 px-4">Regular Hrs</th>
                                  <th className="py-2.5 px-4">Overtime Hrs</th>
                                  <th className="py-2.5 px-4">Total Hrs</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-800">
                                {Object.entries(dailyReport.byEmployee).map(([empId, data]) => {
                                  const empDisp = getEmployeeDisplayId(empId, employees);
                                  return (
                                  <tr key={empId} className="hover:bg-slate-800/30">
                                    <td className="py-3 px-4 font-mono text-blue-400 font-medium w-24 whitespace-nowrap" title={empId !== empDisp ? `Internal ID: ${empId}` : undefined}>{empDisp}</td>
                                    <td className="py-3 px-4 text-white font-medium">{data.employeeName}</td>
                                    <td className="py-3 px-4 font-mono">{data.shifts}</td>
                                    <td className="py-3 px-4 font-mono text-emerald-400">
                                      {data.regularHours.toFixed(1)} hrs
                                    </td>
                                    <td className="py-3 px-4 font-mono text-amber-400 font-bold">
                                      {data.overtimeHours.toFixed(1)} hrs
                                    </td>
                                    <td className="py-3 px-4 font-mono text-white font-bold">
                                      {(data.regularHours + data.overtimeHours).toFixed(1)} hrs
                                    </td>
                                  </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* 4. EMPLOYEES TAB */}
            {activeTab === 'employees' && (
              <div>
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">
                    Registered Workforce Directory
                  </h2>
                  <button
                    onClick={() => {
                      setNewEmpSiteId('');
                      setShowAddEmpModal(true);
                    }}
                    className="px-3.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-md shadow-blue-600/30 transition-all flex items-center gap-1.5 cursor-pointer"
                  >
                    <span>+</span>
                    <span>Register Labourer</span>
                  </button>
                </div>
                {employees.length === 0 ? (
                  <p className="text-sm text-slate-500 py-8 text-center">
                    {isDashboardLoading && !hasCachedData
                      ? 'Loading employee records…'
                      : dashboardError && !hasCachedData
                      ? 'Unable to load employees. Please retry Sync Data.'
                      : 'No employee records found in Google Sheets.'}
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs text-slate-300">
                      <thead className="text-[10px] uppercase tracking-wider text-slate-400 border-b border-slate-700/80">
                        <tr>
                          <th className="py-2.5 pr-4">ID</th>
                          <th className="py-2.5 pr-4">Name</th>
                          <th className="py-2.5 pr-4">Role</th>
                          <th className="py-2.5 pr-4">Assigned Job Site</th>
                          <th className="py-2.5 pr-4">Status</th>
                          <th className="py-2.5 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800">
                        {employees.map((emp) => {
                          const sId = (emp.siteId || '').trim();
                          const matchedSite = sId ? jobSites.find((s) => getSiteId(s) === sId) : null;
                          const empDisp = getEmployeeDisplayId(emp.id, employees);
                          const siteDisp = sId ? getJobSiteDisplayId(sId, jobSites) : '';

                          return (
                            <tr key={emp.id} className="hover:bg-slate-800/30">
                              <td className="py-3 pr-4 font-mono font-medium text-blue-400 w-24 whitespace-nowrap" title={emp.id !== empDisp ? `Internal ID: ${emp.id}` : undefined}>{empDisp}</td>
                              <td className="py-3 pr-4 text-white font-medium max-w-[160px] truncate">{emp.name}</td>
                              <td className="py-3 pr-4">{emp.role}</td>
                              <td className="py-3 pr-4">
                                {!sId || sId === 'FIELD' || sId === 'Unassigned' ? (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                                    <span>⚠️</span> Unassigned
                                  </span>
                                ) : (
                                  <div className="flex flex-col">
                                    <span className="text-white font-medium text-xs">
                                      {matchedSite ? getSiteName(matchedSite) : sId}
                                    </span>
                                    <span className="font-mono text-[10px] text-blue-400">
                                      {siteDisp}
                                    </span>
                                  </div>
                                )}
                              </td>
                              <td className="py-3 pr-4">
                                <span
                                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                    emp.status === 'Active'
                                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                      : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                                  }`}
                                >
                                  {emp.status}
                                </span>
                              </td>
                              <td className="py-3 text-right">
                                <div className="inline-flex items-center gap-1.5 justify-end">
                                  <button
                                    type="button"
                                    onClick={() => handleOpenEditEmp(emp)}
                                    className="px-2.5 py-1 text-xs font-medium text-blue-400 hover:text-white bg-blue-500/10 hover:bg-blue-600 rounded-lg border border-blue-500/20 transition-all cursor-pointer"
                                  >
                                    {sId ? 'Change Site / Edit' : 'Assign Site'}
                                  </button>
                                  {emp.id === 'EMP000' ? (
                                    <span className="text-[10px] text-slate-500 font-mono italic px-2">Primary Admin</span>
                                  ) : emp.status === 'Archived' ? (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setDeleteModalState({
                                          isOpen: true,
                                          actionType: 'restore_employee',
                                          recordId: emp.id,
                                          recordTitle: emp.name,
                                          subtitle: `Role: ${emp.role} • Status: Archived`,
                                        })
                                      }
                                      className="px-2.5 py-1 text-xs font-medium text-emerald-400 hover:text-white bg-emerald-500/10 hover:bg-emerald-600 rounded-lg border border-emerald-500/20 transition-all cursor-pointer"
                                    >
                                      Restore
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setDeleteModalState({
                                          isOpen: true,
                                          actionType: 'archive_employee',
                                          recordId: emp.id,
                                          recordTitle: emp.name,
                                          subtitle: `Role: ${emp.role} • Site: ${emp.siteId || 'Unassigned'}`,
                                        })
                                      }
                                      className="px-2.5 py-1 text-xs font-medium text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg border border-slate-700/60 hover:border-rose-500/30 transition-all cursor-pointer"
                                      title="Archive employee (preserves historical attendance and overtime)"
                                    >
                                      Archive
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* 5. JOB SITES TAB */}
            {activeTab === 'sites' && (
              <div>
                <div className="flex justify-between items-center mb-4">
                  <div>
                    <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">
                      Approved Job Sites & Geofences
                    </h2>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Labourers must be within the designated geofence radius to clock in for shifts.
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setSelectedSiteToEdit(null);
                      setShowSiteModal(true);
                    }}
                    className="px-3.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-md shadow-blue-600/30 transition-all flex items-center gap-1.5 cursor-pointer"
                  >
                    <span>+</span>
                    <span>Add Job Site</span>
                  </button>
                </div>

                {jobSites.length === 0 ? (
                  <div className="py-12 text-center">
                    <p className="text-sm text-slate-400 mb-3">
                      {isDashboardLoading && !hasCachedData
                        ? 'Loading job sites…'
                        : dashboardError && !hasCachedData
                        ? 'Unable to load job sites. Please retry Sync Data.'
                        : 'No job sites found in Google Sheets.'}
                    </p>
                    {(!isDashboardLoading || hasCachedData) && (
                      <button
                        onClick={() => {
                          setSelectedSiteToEdit(null);
                          setShowSiteModal(true);
                        }}
                        className="px-4 py-2 rounded-xl bg-blue-600 text-white text-xs font-semibold shadow-md hover:bg-blue-500"
                      >
                        Create First Job Site
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs text-slate-300">
                      <thead className="text-[10px] uppercase tracking-wider text-slate-400 border-b border-slate-700/80">
                        <tr>
                          <th className="py-2.5 pr-4">Site ID</th>
                          <th className="py-2.5 pr-4">Site Name</th>
                          <th className="py-2.5 pr-4">Address</th>
                          <th className="py-2.5 pr-4">GPS Coordinates</th>
                          <th className="py-2.5 pr-4">Geofence</th>
                          <th className="py-2.5 pr-4">Assigned Workers</th>
                          <th className="py-2.5 pr-4">Status</th>
                          <th className="py-2.5 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800">
                        {jobSites.map((site) => {
                          const sid = getSiteId(site);
                          const sname = getSiteName(site);
                          const siteDisp = getJobSiteDisplayId(sid, jobSites);
                          const sLat = site.lat ?? site.Latitude;
                          const sLon = site.lon ?? site.Longitude;
                          const sRadius = site.geofenceRadius ?? site['Geofence Radius'] ?? 100;
                          const assignedWorkers = employees.filter((e) => (e.siteId || '').trim() === sid);

                          return (
                            <tr key={sid} className="hover:bg-slate-800/30">
                              <td className="py-3 pr-4 font-mono font-medium text-blue-400 w-24 whitespace-nowrap" title={sid !== siteDisp ? `Internal ID: ${sid}` : undefined}>{siteDisp}</td>
                              <td className="py-3 pr-4 text-white font-medium max-w-[160px] truncate">{sname}</td>
                              <td className="py-3 pr-4 text-slate-400 max-w-[180px] truncate" title={site.address || site.Address || ''}>
                                {site.address || site.Address || '—'}
                              </td>
                              <td className="py-3 pr-4 font-mono text-[11px] text-slate-300">
                                {sLat !== undefined && sLon !== undefined ? (
                                  <a
                                    href={`https://www.google.com/maps?q=${sLat},${sLon}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-blue-400 hover:underline flex items-center gap-1"
                                  >
                                    <span>📍</span> {Number(sLat).toFixed(4)}, {Number(sLon).toFixed(4)}
                                  </a>
                                ) : (
                                  '—'
                                )}
                              </td>
                              <td className="py-3 pr-4 font-mono text-emerald-400 font-medium">
                                {sRadius}m
                              </td>
                              <td className="py-3 pr-4">
                                <span className="font-mono text-white font-semibold">
                                  {assignedWorkers.length}
                                </span>{' '}
                                <span className="text-[11px] text-slate-400">workers</span>
                              </td>
                              <td className="py-3 pr-4">
                                <span
                                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                    (site.status || site.Status) === 'Active'
                                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                      : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                                  }`}
                                >
                                  {site.status || site.Status || 'Active'}
                                </span>
                              </td>
                              <td className="py-3 text-right">
                                <div className="inline-flex items-center gap-1.5 justify-end">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setSelectedSiteToEdit(site);
                                      setShowSiteModal(true);
                                    }}
                                    className="px-2.5 py-1 text-xs font-medium text-blue-400 hover:text-white bg-blue-500/10 hover:bg-blue-600 rounded-lg border border-blue-500/20 transition-all cursor-pointer"
                                  >
                                    Edit Site
                                  </button>
                                  {(site.status || site.Status) === 'Archived' ? (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setDeleteModalState({
                                          isOpen: true,
                                          actionType: 'restore_site',
                                          recordId: getSiteId(site),
                                          recordTitle: getSiteName(site),
                                          subtitle: `Address: ${site.address || site.Address || '—'}`,
                                        })
                                      }
                                      className="px-2.5 py-1 text-xs font-medium text-emerald-400 hover:text-white bg-emerald-500/10 hover:bg-emerald-600 rounded-lg border border-emerald-500/20 transition-all cursor-pointer"
                                    >
                                      Restore
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setDeleteModalState({
                                          isOpen: true,
                                          actionType: 'archive_site',
                                          recordId: getSiteId(site),
                                          recordTitle: getSiteName(site),
                                          subtitle: `${assignedWorkers.length} assigned worker(s)`,
                                        })
                                      }
                                      className="px-2.5 py-1 text-xs font-medium text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg border border-slate-700/60 hover:border-rose-500/30 transition-all cursor-pointer"
                                      title="Archive job site (prevents new shifts)"
                                    >
                                      Archive
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}



            {/* 5. AUDIT LOGS TAB */}
            {activeTab === 'audit' && (
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300 mb-4">
                  System Audit Trail
                </h2>
                {auditLogs.length === 0 ? (
                  <p className="text-sm text-slate-500 py-8 text-center">No audit log records recorded yet.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs text-slate-300">
                      <thead className="text-[10px] uppercase tracking-wider text-slate-400 border-b border-slate-700/80">
                        <tr>
                          <th className="py-2.5 pr-4">Timestamp</th>
                          <th className="py-2.5 pr-4">Action</th>
                          <th className="py-2.5 pr-4">Outcome</th>
                          <th className="py-2.5 pr-4">Performed By</th>
                          <th className="py-2.5">Details</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800">
                        {auditLogs.map((log) => (
                          <tr key={log.ID} className="hover:bg-slate-800/30">
                            <td className="py-3 pr-4 font-mono text-slate-400">
                              {new Date(log.Timestamp).toLocaleString()}
                            </td>
                            <td className="py-3 pr-4 font-mono font-medium text-white">{log.Action}</td>
                            <td className="py-3 pr-4">
                              <span
                                className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                  log.Outcome === 'success'
                                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                    : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                                }`}
                              >
                                {log.Outcome}
                              </span>
                            </td>
                            <td className="py-3 pr-4 font-mono text-blue-400">{log['Performed By']}</td>
                            <td className="py-3 text-slate-300">{log.Details}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* 6. ARCHIVED RECORDS & SAFE RESTORATION TAB */}
            {activeTab === 'archived' && (
              <div className="space-y-6">
                {/* Header & Controls */}
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                  <div>
                    <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">
                      Archived & Voided Records
                    </h2>
                    <p className="text-xs text-slate-400">
                      Audit-safe repository of archived employees, job sites, voided shifts, and cancelled overtime.
                    </p>
                  </div>
                  <div className="flex items-center gap-2 w-full sm:w-auto">
                    <button
                      onClick={() => refreshArchivedRecords()}
                      disabled={archivedLoading}
                      className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      <span className={archivedLoading ? 'animate-spin' : ''}>↻</span>
                      <span>Refresh</span>
                    </button>
                    <div className="relative flex-1 sm:w-64">
                      <input
                        type="text"
                        placeholder="Search archived..."
                        value={archivedSearchQuery}
                        onChange={(e) => setArchivedSearchQuery(e.target.value)}
                        className="w-full px-3 py-1.5 bg-slate-800/80 border border-slate-700/80 rounded-xl text-white text-xs placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      {archivedSearchQuery && (
                        <button
                          onClick={() => setArchivedSearchQuery('')}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white text-xs cursor-pointer"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Sub-filter Navigation Pills */}
                <div className="flex flex-wrap gap-2 border-b border-slate-800 pb-3">
                  {[
                    {
                      id: 'all',
                      label: 'All Records',
                      count:
                        (archivedCounts?.archivedEmployees || 0) +
                        (archivedCounts?.archivedJobSites || 0) +
                        (archivedCounts?.voidedShifts || 0) +
                        (archivedCounts?.voidedOvertime || 0),
                    },
                    { id: 'employees', label: 'Archived Employees', count: archivedEmployees.length },
                    { id: 'sites', label: 'Archived Sites', count: archivedJobSites.length },
                    { id: 'shifts', label: 'Voided Shifts', count: voidedShifts.length },
                    { id: 'overtime', label: 'Cancelled Overtime', count: voidedOvertime.length },
                    { id: 'duplicates', label: 'Duplicate Collisions', count: duplicates.length },
                  ].map((filter) => (
                    <button
                      key={filter.id}
                      onClick={() => setArchivedSubTab(filter.id as typeof archivedSubTab)}
                      className={`px-3 py-1 rounded-xl text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
                        archivedSubTab === filter.id
                          ? 'bg-blue-600 text-white shadow-sm shadow-blue-500/20'
                          : 'bg-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-700/80'
                      }`}
                    >
                      <span>{filter.label}</span>
                      <span
                        className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
                          archivedSubTab === filter.id ? 'bg-blue-500/40 text-white' : 'bg-slate-700 text-slate-300'
                        }`}
                      >
                        {filter.count}
                      </span>
                    </button>
                  ))}
                </div>

                {/* Duplicate Record Resolution Alert */}
                {(archivedSubTab === 'all' || archivedSubTab === 'duplicates') && duplicates.length > 0 && (
                  <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 space-y-3">
                    <div className="flex items-center gap-2">
                      <span className="text-base">⚠️</span>
                      <h3 className="text-xs font-bold uppercase tracking-wider text-amber-300">
                        Duplicate Identity Collisions Detected ({duplicates.length})
                      </h3>
                    </div>
                    <p className="text-xs text-amber-200/80 leading-relaxed">
                      Safe duplicate resolution: Never merge records automatically. Related records are shown below so you can archive duplicate profiles without deleting historical IDs or attendance logs.
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
                      {duplicates.map((dup) => (
                        <div key={dup.id} className="p-3 rounded-xl bg-slate-900/80 border border-amber-500/20 space-y-2">
                          <div className="flex justify-between items-start">
                            <div>
                              <div className="text-xs font-bold text-white">{dup.name}</div>
                              <div className="text-[11px] font-mono text-amber-400">ID: {dup.id}</div>
                              {dup.phone && <div className="text-[10px] text-slate-400">Phone: {dup.phone}</div>}
                            </div>
                            <button
                              onClick={() =>
                                setDeleteModalState({
                                  isOpen: true,
                                  actionType: 'archive_employee',
                                  recordId: dup.id,
                                  recordTitle: `${dup.name} (${dup.id})`,
                                  subtitle: `Duplicate collision with other ${dup.recordType || 'employee'} entries`,
                                })
                              }
                              className="px-2.5 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-[10px] font-semibold cursor-pointer transition-all"
                            >
                              Archive Duplicate
                            </button>
                          </div>
                          {dup.relatedRecords && dup.relatedRecords.length > 0 && (
                            <div className="pt-2 border-t border-slate-800 text-[10px] text-slate-400 space-y-1">
                              <span className="font-semibold text-slate-300">Collides with:</span>
                              {dup.relatedRecords.map((rel) => (
                                <div key={rel.id} className="flex justify-between font-mono text-[10px]">
                                  <span>
                                    {rel.name} ({rel.id})
                                  </span>
                                  <span className={rel.status === 'Archived' ? 'text-amber-400' : 'text-emerald-400'}>
                                    {rel.status}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Filter logic helper */}
                {(() => {
                  const query = archivedSearchQuery.trim().toLowerCase();
                  const filteredEmployees = archivedEmployees.filter(
                    (e) =>
                      !query ||
                      e.name.toLowerCase().includes(query) ||
                      e.id.toLowerCase().includes(query) ||
                      (e.archiveReason || '').toLowerCase().includes(query)
                  );
                  const filteredSites = archivedJobSites.filter(
                    (s) =>
                      !query ||
                      s.name.toLowerCase().includes(query) ||
                      s.id.toLowerCase().includes(query) ||
                      (s.archiveReason || '').toLowerCase().includes(query)
                  );
                  const filteredShifts = voidedShifts.filter(
                    (s) =>
                      !query ||
                      s.shiftId.toLowerCase().includes(query) ||
                      s.employeeName.toLowerCase().includes(query) ||
                      s.siteName.toLowerCase().includes(query) ||
                      (s.voidReason || '').toLowerCase().includes(query)
                  );
                  const filteredOvertime = voidedOvertime.filter(
                    (o) =>
                      !query ||
                      o.id.toLowerCase().includes(query) ||
                      o.employeeName.toLowerCase().includes(query) ||
                      (o.voidReason || '').toLowerCase().includes(query)
                  );

                  const totalMatching =
                    filteredEmployees.length + filteredSites.length + filteredShifts.length + filteredOvertime.length;

                  if (archivedLoading) {
                    return (
                      <div className="py-12 flex flex-col items-center justify-center text-slate-400 space-y-3">
                        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                        <p className="text-xs">Loading archived records from Google Sheets...</p>
                      </div>
                    );
                  }

                  if (totalMatching === 0 && !archivedLoading) {
                    return (
                      <div className="p-8 text-center text-slate-500 space-y-2">
                        <p className="text-sm font-medium">No archived or voided records found.</p>
                        <p className="text-xs text-slate-600">
                          {query ? 'No records matched your search query.' : 'All system records are currently active.'}
                        </p>
                      </div>
                    );
                  }

                  return (
                    <div className="space-y-8">
                      {/* Section A: Archived Employees */}
                      {(archivedSubTab === 'all' || archivedSubTab === 'employees') && filteredEmployees.length > 0 && (
                        <div>
                          <div className="flex items-center gap-2 mb-3">
                            <span className="text-sm">👷</span>
                            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                              Archived Employees ({filteredEmployees.length})
                            </h3>
                          </div>
                          <div className="overflow-x-auto rounded-xl border border-slate-800">
                            <table className="w-full text-left text-xs text-slate-300">
                              <thead className="text-[10px] uppercase tracking-wider text-slate-400 bg-slate-900/60 border-b border-slate-800">
                                <tr>
                                  <th className="py-2.5 px-3">Employee</th>
                                  <th className="py-2.5 px-3">Archived At (GST)</th>
                                  <th className="py-2.5 px-3">Archived By</th>
                                  <th className="py-2.5 px-3">Reason</th>
                                  <th className="py-2.5 px-3">Historical Shifts</th>
                                  <th className="py-2.5 px-3 text-right">Action</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-800/60">
                                {filteredEmployees.map((emp) => {
                                  const empDisp = getEmployeeDisplayId(emp.id, employees);
                                  return (
                                  <tr key={emp.id} className="hover:bg-slate-800/30">
                                    <td className="py-3 px-3">
                                      <div className="font-semibold text-white">{emp.name}</div>
                                      <div className="text-[11px] font-mono text-blue-400" title={emp.id !== empDisp ? `Internal ID: ${emp.id}` : undefined}>{empDisp}</div>
                                      {emp.phone && <div className="text-[10px] text-slate-500">{emp.phone}</div>}
                                    </td>
                                    <td className="py-3 px-3 font-mono text-[11px] text-slate-300 whitespace-nowrap">
                                      {formatUaeDateTime(emp.archivedAt)}
                                    </td>
                                    <td className="py-3 px-3 font-mono text-[11px] text-blue-300">
                                      {emp.archivedBy || '—'}
                                    </td>
                                    <td className="py-3 px-3 text-slate-300 max-w-xs truncate">
                                      {emp.archiveReason || '—'}
                                    </td>
                                    <td className="py-3 px-3 font-mono text-[11px] text-slate-400">
                                      {emp.historicalShiftsCount ?? 0} shifts ({Number(emp.historicalTotalHours ?? 0).toFixed(1)}h)
                                    </td>
                                    <td className="py-3 px-3 text-right">
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setDeleteModalState({
                                            isOpen: true,
                                            actionType: 'restore_employee',
                                            recordId: emp.id,
                                            recordTitle: `${emp.name} (${empDisp})`,
                                            subtitle: `Current status: Archived. Restoring will reactivate PIN and shift access.`,
                                          })
                                        }
                                        className="px-2.5 py-1 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[11px] font-medium transition-all cursor-pointer inline-flex items-center gap-1"
                                      >
                                        <span>♻️</span>
                                        <span>Restore</span>
                                      </button>
                                    </td>
                                  </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {/* Section B: Archived Job Sites */}
                      {(archivedSubTab === 'all' || archivedSubTab === 'sites') && filteredSites.length > 0 && (
                        <div>
                          <div className="flex items-center gap-2 mb-3">
                            <span className="text-sm">📍</span>
                            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                              Archived Job Sites ({filteredSites.length})
                            </h3>
                          </div>
                          <div className="overflow-x-auto rounded-xl border border-slate-800">
                            <table className="w-full text-left text-xs text-slate-300">
                              <thead className="text-[10px] uppercase tracking-wider text-slate-400 bg-slate-900/60 border-b border-slate-800">
                                <tr>
                                  <th className="py-2.5 px-3">Job Site</th>
                                  <th className="py-2.5 px-3">Archived At (GST)</th>
                                  <th className="py-2.5 px-3">Archived By</th>
                                  <th className="py-2.5 px-3">Reason</th>
                                  <th className="py-2.5 px-3">Historical Shifts</th>
                                  <th className="py-2.5 px-3 text-right">Action</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-800/60">
                                {filteredSites.map((site) => {
                                  const siteDisp = getJobSiteDisplayId(site.id, jobSites);
                                  return (
                                  <tr key={site.id} className="hover:bg-slate-800/30">
                                    <td className="py-3 px-3">
                                      <div className="font-semibold text-white">{site.name}</div>
                                      <div className="text-[11px] font-mono text-emerald-400" title={site.id !== siteDisp ? `Internal ID: ${site.id}` : undefined}>{siteDisp}</div>
                                      {site.address && <div className="text-[10px] text-slate-500">{site.address}</div>}
                                    </td>
                                    <td className="py-3 px-3 font-mono text-[11px] text-slate-300 whitespace-nowrap">
                                      {formatUaeDateTime(site.archivedAt)}
                                    </td>
                                    <td className="py-3 px-3 font-mono text-[11px] text-blue-300">
                                      {site.archivedBy || '—'}
                                    </td>
                                    <td className="py-3 px-3 text-slate-300 max-w-xs truncate">
                                      {site.archiveReason || '—'}
                                    </td>
                                    <td className="py-3 px-3 font-mono text-[11px] text-slate-400">
                                      {site.historicalShiftsCount ?? 0} shifts
                                    </td>
                                    <td className="py-3 px-3 text-right">
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setDeleteModalState({
                                            isOpen: true,
                                            actionType: 'restore_site',
                                            recordId: site.id,
                                            recordTitle: `${site.name} (${siteDisp})`,
                                            subtitle: `Current status: Archived. Restoring will allow employee assignment and shifts.`,
                                          })
                                        }
                                        className="px-2.5 py-1 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[11px] font-medium transition-all cursor-pointer inline-flex items-center gap-1"
                                      >
                                        <span>♻️</span>
                                        <span>Restore</span>
                                      </button>
                                    </td>
                                  </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {/* Section C: Voided Shifts */}
                      {(archivedSubTab === 'all' || archivedSubTab === 'shifts') && filteredShifts.length > 0 && (
                        <div>
                          <div className="flex items-center gap-2 mb-3">
                            <span className="text-sm">⏱️</span>
                            <h3 className="text-xs font-bold uppercase tracking-wider text-rose-300">
                              Voided Attendance Shifts ({filteredShifts.length})
                            </h3>
                          </div>
                          <div className="overflow-x-auto rounded-xl border border-slate-800">
                            <table className="w-full text-left text-xs text-slate-300">
                              <thead className="text-[10px] uppercase tracking-wider text-slate-400 bg-slate-900/60 border-b border-slate-800">
                                <tr>
                                  <th className="py-2.5 px-3">Shift ID / Employee</th>
                                  <th className="py-2.5 px-3">Site</th>
                                  <th className="py-2.5 px-3">Voided At (GST)</th>
                                  <th className="py-2.5 px-3">Voided By</th>
                                  <th className="py-2.5 px-3">Void Reason</th>
                                  <th className="py-2.5 px-3">Original Hours</th>
                                  <th className="py-2.5 px-3 text-right">Status</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-800/60">
                                {filteredShifts.map((shift) => (
                                  <tr key={shift.shiftId || shift.id} className="hover:bg-slate-800/30">
                                    <td className="py-3 px-3">
                                      <div className="font-semibold text-white">{shift.employeeName || shift.employeeId}</div>
                                      <div className="text-[10px] font-mono text-slate-500">Shift #{shift.shiftId || shift.id}</div>
                                    </td>
                                    <td className="py-3 px-3 text-slate-300">{shift.siteName || shift.siteId}</td>
                                    <td className="py-3 px-3 font-mono text-[11px] text-slate-300 whitespace-nowrap">
                                      {formatUaeDateTime(shift.voidedAt)}
                                    </td>
                                    <td className="py-3 px-3 font-mono text-[11px] text-blue-300">{shift.voidedBy || '—'}</td>
                                    <td className="py-3 px-3 text-rose-300 max-w-xs truncate">{shift.voidReason || '—'}</td>
                                    <td className="py-3 px-3 font-mono text-[11px] text-slate-500 line-through">
                                      {shift.regularHours}h reg / {shift.overtimeHours}h OT
                                    </td>
                                    <td className="py-3 px-3 text-right">
                                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/10 text-rose-400 border border-rose-500/20">
                                        Voided
                                      </span>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {/* Section D: Cancelled Overtime */}
                      {(archivedSubTab === 'all' || archivedSubTab === 'overtime') && filteredOvertime.length > 0 && (
                        <div>
                          <div className="flex items-center gap-2 mb-3">
                            <span className="text-sm">⏳</span>
                            <h3 className="text-xs font-bold uppercase tracking-wider text-amber-300">
                              Cancelled Overtime Records ({filteredOvertime.length})
                            </h3>
                          </div>
                          <div className="overflow-x-auto rounded-xl border border-slate-800">
                            <table className="w-full text-left text-xs text-slate-300">
                              <thead className="text-[10px] uppercase tracking-wider text-slate-400 bg-slate-900/60 border-b border-slate-800">
                                <tr>
                                  <th className="py-2.5 px-3">OT ID / Employee</th>
                                  <th className="py-2.5 px-3">Date</th>
                                  <th className="py-2.5 px-3">Cancelled At (GST)</th>
                                  <th className="py-2.5 px-3">Cancelled By</th>
                                  <th className="py-2.5 px-3">Cancellation Reason</th>
                                  <th className="py-2.5 px-3">Hours</th>
                                  <th className="py-2.5 px-3 text-right">Status</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-800/60">
                                {filteredOvertime.map((ot) => (
                                  <tr key={ot.id} className="hover:bg-slate-800/30">
                                    <td className="py-3 px-3">
                                      <div className="font-semibold text-white">{ot.employeeName || ot.employeeId}</div>
                                      <div className="text-[10px] font-mono text-slate-500">
                                        OT #{ot.id} (Shift #{ot.shiftId})
                                      </div>
                                    </td>
                                    <td className="py-3 px-3 font-mono text-[11px] text-slate-300">{ot.date}</td>
                                    <td className="py-3 px-3 font-mono text-[11px] text-slate-300 whitespace-nowrap">
                                      {formatUaeDateTime(ot.voidedAt)}
                                    </td>
                                    <td className="py-3 px-3 font-mono text-[11px] text-blue-300">{ot.voidedBy || '—'}</td>
                                    <td className="py-3 px-3 text-amber-300 max-w-xs truncate">{ot.voidReason || '—'}</td>
                                    <td className="py-3 px-3 font-mono text-[11px] text-slate-500 line-through">
                                      {ot.overtimeHours}h
                                    </td>
                                    <td className="py-3 px-3 text-right">
                                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                                        Cancelled
                                      </span>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}
          </>
        )}
      </main>

      {/* Add Employee Modal */}
      {showAddEmpModal && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="glass-panel bg-slate-900 border border-slate-700 rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl">
            <h3 className="text-lg font-bold text-white mb-2">Register New Labourer</h3>
            <p className="text-xs text-slate-400 mb-6">
              Creates an employee record in Google Sheets with standard PBKDF2 PIN hashing (25,000 iterations).
            </p>

            {addEmpModalError && (
              <div className="mb-4 p-3 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-2">
                <span>⚠️</span>
                <span className="flex-1">{addEmpModalError}</span>
              </div>
            )}

            <form onSubmit={handleCreateEmployee} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
                  Employee ID (Optional)
                </label>
                <input
                  type="text"
                  placeholder="Leave blank for auto-ID (e.g. EMP001, EMP002...)"
                  value={newEmpCustomId}
                  onChange={(e) => setNewEmpCustomId(e.target.value.toUpperCase())}
                  className="w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder:text-slate-500"
                />
                <p className="mt-1 text-[11px] text-slate-400">
                  Leave blank to auto-generate short sequential ID (e.g. <span className="text-blue-400 font-mono">EMP001</span>), or type custom number.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
                  Full Name
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Tariq Mahmoud"
                  value={newEmpName}
                  onChange={(e) => setNewEmpName(e.target.value)}
                  className="w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
                  Phone Number
                </label>
                <input
                  type="tel"
                  placeholder="+971501234567"
                  value={newEmpPhone}
                  onChange={(e) => setNewEmpPhone(e.target.value)}
                  className="w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
                  Assigned Job Site
                </label>
                <select
                  value={newEmpSiteId}
                  onChange={(e) => setNewEmpSiteId(e.target.value)}
                  className="w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">-- No Site Assigned (Unassigned) --</option>
                  {jobSites.map((s) => {
                    const sid = getSiteId(s);
                    const sname = getSiteName(s);
                    const sdisp = getJobSiteDisplayId(sid, jobSites);
                    return (
                      <option key={sid} value={sid}>
                        {sname} ({sdisp})
                      </option>
                    );
                  })}
                </select>
                <p className="mt-1 text-[11px] text-slate-400">
                  Select the approved work site. The labourer can only clock in within its geofence.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
                  Initial Access PIN
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  required
                  placeholder="4 to 6 digit PIN"
                  value={newEmpPin}
                  onChange={(e) => setNewEmpPin(e.target.value)}
                  className="w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setAddEmpModalError(null);
                    setShowAddEmpModal(false);
                  }}
                  className="flex-1 py-2.5 rounded-xl text-xs font-semibold text-slate-300 bg-slate-800 hover:bg-slate-700 border border-slate-700 transition-all cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingModal}
                  className="flex-1 py-2.5 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 shadow-lg shadow-blue-600/30 transition-all disabled:opacity-50 cursor-pointer"
                >
                  {submittingModal ? 'Registering...' : 'Register Labourer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Employee Modal */}
      {editingEmp && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="glass-panel bg-slate-900 border border-slate-700 rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl">
            <h3 className="text-lg font-bold text-white mb-1">Edit Employee Profile</h3>
            <p className="text-xs text-slate-400 mb-5">
              Change long or messy IDs (e.g. rename to <span className="text-blue-400 font-mono">EMP001</span>), edit name, or reset PIN.
            </p>

            {editEmpModalError && (
              <div className="mb-4 p-3 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-2">
                <span>⚠️</span>
                <span className="flex-1">{editEmpModalError}</span>
              </div>
            )}

            <form onSubmit={handleUpdateEmployee} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
                  Employee ID
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. EMP001"
                  value={editEmpId}
                  onChange={(e) => setEditEmpId(e.target.value.toUpperCase())}
                  className="w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="mt-1 text-[11px] text-slate-400">
                  Workers can enter this ID or simply their numbers (e.g. 1 or 001) to log in.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
                  Full Name
                </label>
                <input
                  type="text"
                  required
                  value={editEmpName}
                  onChange={(e) => setEditEmpName(e.target.value)}
                  className="w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
                  Phone Number
                </label>
                <input
                  type="tel"
                  placeholder="+971501234567"
                  value={editEmpPhone}
                  onChange={(e) => setEditEmpPhone(e.target.value)}
                  className="w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
                  Assigned Job Site
                </label>
                <select
                  value={editEmpSiteId}
                  onChange={(e) => setEditEmpSiteId(e.target.value)}
                  className="w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">-- No Site Assigned (Unassigned) --</option>
                  {jobSites.map((s) => {
                    const sid = getSiteId(s);
                    const sname = getSiteName(s);
                    const sdisp = getJobSiteDisplayId(sid, jobSites);
                    return (
                      <option key={sid} value={sid}>
                        {sname} ({sdisp})
                      </option>
                    );
                  })}
                </select>
                <p className="mt-1 text-[11px] text-slate-400">
                  Update site assignment at any time. Previous shifts retain their original job site.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
                  Status
                </label>
                <select
                  value={editEmpStatus}
                  onChange={(e) => setEditEmpStatus(e.target.value)}
                  className="w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="Active">Active</option>
                  <option value="Inactive">Inactive</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
                  Reset PIN (Optional)
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  placeholder="Leave blank to keep existing PIN"
                  value={editEmpPin}
                  onChange={(e) => setEditEmpPin(e.target.value)}
                  className="w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setEditEmpModalError(null);
                    setEditingEmp(null);
                  }}
                  className="flex-1 py-2.5 rounded-xl text-xs font-semibold text-slate-300 bg-slate-800 hover:bg-slate-700 border border-slate-700 transition-all cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingModal}
                  className="flex-1 py-2.5 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 shadow-lg shadow-blue-600/30 transition-all disabled:opacity-50 cursor-pointer"
                >
                  {submittingModal ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}



      {/* Job Site Modal */}
      {showSiteModal && (
        <JobSiteModal
          token={session.token}
          siteToEdit={selectedSiteToEdit}
          onClose={() => setShowSiteModal(false)}
          onSaved={(msg, savedSite) => {
            setActionMessage({ type: 'success', text: msg });
            if (savedSite) {
              const savedId = savedSite.ID || savedSite.id;
              if (savedId) {
                if (selectedSiteToEdit) {
                  updateJobSiteLocally(savedSite);
                } else {
                  addJobSiteLocally(savedSite);
                }
              }
            }
            setShowSiteModal(false);
            setSelectedSiteToEdit(null);
          }}
        />
      )}

      {/* Change PIN Modal */}
      <ChangePinModal
        token={session.token}
        isOpen={showPinModal}
        onClose={() => setShowPinModal(false)}
        onSuccess={() => setActionMessage({ type: 'success', text: 'Administrator PIN updated successfully!' })}
      />

      {/* Verified Attendance Photo Preview Modal */}
      {previewPhoto && (
        <PhotoModal
          isOpen={Boolean(previewPhoto)}
          photoKey={previewPhoto.key}
          token={session.token}
          title={previewPhoto.title}
          employeeName={previewPhoto.employeeName}
          employeeId={previewPhoto.employeeId}
          timestamp={previewPhoto.timestamp}
          lat={previewPhoto.lat}
          lon={previewPhoto.lon}
          accuracy={previewPhoto.accuracy}
          status={previewPhoto.status}
          onClose={() => setPreviewPhoto(null)}
          onPurgePhoto={() => {
            setDeleteModalState({
              isOpen: true,
              actionType: 'purge_photo',
              recordId: previewPhoto.shiftId || previewPhoto.key,
              recordTitle: `${previewPhoto.employeeName || previewPhoto.employeeId} (${previewPhoto.title})`,
              subtitle: `Storage Key: ${previewPhoto.key}`,
              shiftPhotoType: previewPhoto.title.includes('Clock-out') ? 'end' : 'start',
            });
          }}
        />
      )}

      {/* Unified Confirm Delete / Archive / Void / Restore Modal */}
      {deleteModalState && (
        <ConfirmDeleteModal
          isOpen={deleteModalState.isOpen}
          actionType={deleteModalState.actionType}
          recordId={deleteModalState.recordId}
          recordTitle={deleteModalState.recordTitle}
          subtitle={deleteModalState.subtitle}
          isSubmitting={isSubmittingDelete}
          serverError={deleteModalError}
          onConfirm={handleExecuteConfirmAction}
          onClose={() => {
            setDeleteModalError(null);
            setDeleteModalState(null);
          }}
        />
      )}
    </div>
  );
}
