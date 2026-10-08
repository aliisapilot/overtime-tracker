import React, { useState, useEffect, useCallback } from 'react';
import {
  UserSession,
  JobSite,
  EmployeeProfile,
  getEmployees,
  createEmployee,
  getJobSites,
  createJobSite,
  getAttendance,
  getPendingOvertime,
  approveOvertime,
  getAuditLogs,
  generateDailyReport,
} from '@/lib/api';
import ChangePinModal from '@/components/ChangePinModal';

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
  ID: string;
  'Employee ID': string;
  'Site ID': string;
  'Start Time': string;
  'End Time'?: string;
  'Regular Hours'?: number;
  'Overtime Hours'?: number;
  Status: string;
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

export default function AdminDashboard({ session, onLogout }: AdminDashboardProps) {
  const [activeTab, setActiveTab] = useState<'overtime' | 'attendance' | 'reports' | 'employees' | 'sites' | 'audit'>('overtime');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Reports state
  const [reportDate, setReportDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [dailyReport, setDailyReport] = useState<DailyReportData | null>(null);
  const [loadingReport, setLoadingReport] = useState(false);

  // Data states
  const [employees, setEmployees] = useState<EmployeeProfile[]>([]);
  const [sites, setSites] = useState<JobSite[]>([]);
  const [overtimeList, setOvertimeList] = useState<OvertimeItem[]>([]);
  const [attendanceList, setAttendanceList] = useState<AttendanceItem[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([]);

  // Modals state
  const [showAddEmpModal, setShowAddEmpModal] = useState(false);
  const [showAddSiteModal, setShowAddSiteModal] = useState(false);
  const [submittingModal, setSubmittingModal] = useState(false);
  const [showPinModal, setShowPinModal] = useState(false);

  // New Employee Form
  const [newEmpName, setNewEmpName] = useState('');
  const [newEmpPhone, setNewEmpPhone] = useState('');
  const [newEmpSiteId, setNewEmpSiteId] = useState('');
  const [newEmpPin, setNewEmpPin] = useState('');

  // New Job Site Form
  const [newSiteName, setNewSiteName] = useState('');
  const [newSiteAddress, setNewSiteAddress] = useState('');
  const [newSiteLat, setNewSiteLat] = useState('25.2533');
  const [newSiteLon, setNewSiteLon] = useState('55.3652');
  const [newSiteRadius, setNewSiteRadius] = useState('100');

  const handleCreateEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmpName.trim() || !newEmpPin.trim()) {
      setActionMessage({ type: 'error', text: 'Employee Name and PIN are required' });
      return;
    }
    setSubmittingModal(true);
    try {
      const res = await createEmployee(session.token, {
        name: newEmpName.trim(),
        phone: newEmpPhone.trim(),
        role: 'Labourer',
        siteId: newEmpSiteId,
        pin: newEmpPin.trim(),
      });
      if (res.success) {
        setActionMessage({ type: 'success', text: `Labourer ${newEmpName} registered successfully in Google Sheets!` });
        setShowAddEmpModal(false);
        setNewEmpName('');
        setNewEmpPhone('');
        setNewEmpPin('');
        handleRefresh();
      } else {
        setActionMessage({ type: 'error', text: res.message || 'Failed to create employee' });
      }
    } catch (err: unknown) {
      setActionMessage({ type: 'error', text: (err as Error).message });
    } finally {
      setSubmittingModal(false);
    }
  };

  const handleCreateJobSite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSiteName.trim() || !newSiteLat || !newSiteLon) {
      setActionMessage({ type: 'error', text: 'Site Name and GPS Coordinates are required' });
      return;
    }
    setSubmittingModal(true);
    try {
      const res = await createJobSite(session.token, {
        name: newSiteName.trim(),
        address: newSiteAddress.trim(),
        latitude: parseFloat(newSiteLat),
        longitude: parseFloat(newSiteLon),
        geofenceRadius: parseInt(newSiteRadius, 10) || 100,
      });
      if (res.success) {
        setActionMessage({ type: 'success', text: `Job Site ${newSiteName} created successfully in Google Sheets!` });
        setShowAddSiteModal(false);
        setNewSiteName('');
        setNewSiteAddress('');
        handleRefresh();
      } else {
        setActionMessage({ type: 'error', text: res.message || 'Failed to create job site' });
      }
    } catch (err: unknown) {
      setActionMessage({ type: 'error', text: (err as Error).message });
    } finally {
      setSubmittingModal(false);
    }
  };

  const handleExportCsv = () => {
    if (attendanceList.length === 0) return;
    const headers = ['Shift ID', 'Employee ID', 'Site ID', 'Start Time', 'End Time', 'Regular Hours', 'Overtime Hours', 'Status'];
    const rows = attendanceList.map((att) => [
      att.ID,
      att['Employee ID'],
      att['Site ID'],
      att['Start Time'],
      att['End Time'] || '',
      att['Regular Hours'] || 0,
      att['Overtime Hours'] || 0,
      att.Status,
    ]);

    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `attendance_report_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleGenerateReport = useCallback(
    async (selectedDate?: string) => {
      setLoadingReport(true);
      try {
        const targetDate = selectedDate || reportDate;
        const res = await generateDailyReport(session.token, targetDate);
        if (res.success && res.report) {
          setDailyReport(res.report as DailyReportData);
        } else {
          setActionMessage({ type: 'error', text: res.message || 'Failed to generate daily report' });
        }
      } catch (err: unknown) {
        setActionMessage({ type: 'error', text: (err as Error).message });
      } finally {
        setLoadingReport(false);
      }
    },
    [session.token, reportDate]
  );

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

  const loadAllData = useCallback(async () => {
    try {
      const [empRes, sitesRes, otRes, attRes, auditRes] = await Promise.all([
        getEmployees(session.token),
        getJobSites(session.token),
        getPendingOvertime(session.token),
        getAttendance(session.token),
        getAuditLogs(session.token, 20),
      ]);

      if (empRes.success && Array.isArray(empRes.employees)) {
        setEmployees(empRes.employees);
      }
      if (sitesRes.success && Array.isArray(sitesRes.sites)) {
        setSites(sitesRes.sites);
      }
      if (otRes.success && Array.isArray(otRes.overtime)) {
        setOvertimeList(otRes.overtime as OvertimeItem[]);
      }
      if (attRes.success && Array.isArray(attRes.attendance)) {
        setAttendanceList(attRes.attendance as AttendanceItem[]);
      }
      if (auditRes.success && Array.isArray(auditRes.logs)) {
        setAuditLogs(auditRes.logs as AuditLogItem[]);
      }
    } catch (err: unknown) {
      console.error('Failed to load admin data:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [session.token]);

  useEffect(() => {
    loadAllData();
  }, [loadAllData]);

  useEffect(() => {
    if (activeTab === 'reports' && !dailyReport) {
      handleGenerateReport();
    }
  }, [activeTab, dailyReport, handleGenerateReport]);

  const handleRefresh = () => {
    setRefreshing(true);
    loadAllData();
  };

  const handleApproveOvertime = async (otId: string) => {
    try {
      const res = await approveOvertime(session.token, otId);
      if (res.success) {
        setActionMessage({ type: 'success', text: `Overtime record ${otId} approved successfully!` });
        handleRefresh();
      } else {
        setActionMessage({ type: 'error', text: res.message || 'Failed to approve overtime' });
      }
    } catch (err: unknown) {
      setActionMessage({ type: 'error', text: (err as Error).message });
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
          <button
            onClick={() => setShowPinModal(true)}
            className="px-3.5 py-2 text-xs font-semibold uppercase tracking-wider text-slate-300 hover:text-white bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 rounded-xl transition-all cursor-pointer"
          >
            Change PIN
          </button>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="px-4 py-2 text-xs font-semibold uppercase tracking-wider text-blue-400 hover:text-blue-300 bg-blue-950/40 hover:bg-blue-900/50 border border-blue-800/60 rounded-xl transition-all cursor-pointer flex items-center gap-1.5"
          >
            <span className={refreshing ? 'animate-spin' : ''}>↻</span>
            <span>{refreshing ? 'Syncing...' : 'Sync Data'}</span>
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

      {/* Overview Stat Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="glass-card rounded-2xl p-4">
          <span className="text-xs font-medium text-slate-400 block mb-1">Total Employees</span>
          <span className="text-2xl font-bold text-white font-mono">{employees.length}</span>
        </div>
        <div className="glass-card rounded-2xl p-4">
          <span className="text-xs font-medium text-slate-400 block mb-1">Active Job Sites</span>
          <span className="text-2xl font-bold text-white font-mono">{sites.length}</span>
        </div>
        <div className="glass-card rounded-2xl p-4 border-amber-500/30 bg-amber-500/5">
          <span className="text-xs font-medium text-amber-400 block mb-1">Pending Overtime</span>
          <span className="text-2xl font-bold text-amber-300 font-mono">{overtimeList.length}</span>
        </div>
        <div className="glass-card rounded-2xl p-4">
          <span className="text-xs font-medium text-slate-400 block mb-1">Today's Attendance</span>
          <span className="text-2xl font-bold text-emerald-400 font-mono">{attendanceList.length}</span>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex border-b border-slate-800 space-x-1 sm:space-x-2 overflow-x-auto pb-1">
        {[
          { id: 'overtime', label: `Pending Overtime (${overtimeList.length})` },
          { id: 'attendance', label: 'Attendance Ledger' },
          { id: 'reports', label: 'Daily Reports' },
          { id: 'employees', label: 'Employees' },
          { id: 'sites', label: 'Job Sites' },
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
        {loading ? (
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
                        {overtimeList.map((ot) => (
                          <tr key={ot.ID} className="hover:bg-slate-800/30">
                            <td className="py-3 pr-4 font-mono text-slate-400">{ot.ID}</td>
                            <td className="py-3 pr-4 font-mono font-medium text-white">{ot['Employee ID']}</td>
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
                              <button
                                onClick={() => handleApproveOvertime(ot.ID)}
                                className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold transition-all cursor-pointer"
                              >
                                Approve
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* 2. ATTENDANCE TAB */}
            {activeTab === 'attendance' && (
              <div>
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">
                    Attendance & Shift Ledger
                  </h2>
                  {attendanceList.length > 0 && (
                    <button
                      onClick={handleExportCsv}
                      className="px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-blue-400 hover:text-blue-300 border border-slate-700 text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer shadow-sm"
                    >
                      <span>📥</span>
                      <span>Export Attendance CSV</span>
                    </button>
                  )}
                </div>
                {attendanceList.length === 0 ? (
                  <p className="text-sm text-slate-500 py-8 text-center">No attendance shifts recorded for today yet.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs text-slate-300">
                      <thead className="text-[10px] uppercase tracking-wider text-slate-400 border-b border-slate-700/80">
                        <tr>
                          <th className="py-2.5 pr-4">Shift ID</th>
                          <th className="py-2.5 pr-4">Employee ID</th>
                          <th className="py-2.5 pr-4">Site</th>
                          <th className="py-2.5 pr-4">Clock In</th>
                          <th className="py-2.5 pr-4">Clock Out</th>
                          <th className="py-2.5 pr-4">Reg / OT</th>
                          <th className="py-2.5">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800">
                        {attendanceList.map((att) => (
                          <tr key={att.ID} className="hover:bg-slate-800/30">
                            <td className="py-3 pr-4 font-mono text-slate-400">{att.ID}</td>
                            <td className="py-3 pr-4 font-mono font-medium text-white">{att['Employee ID']}</td>
                            <td className="py-3 pr-4 font-mono">{att['Site ID']}</td>
                            <td className="py-3 pr-4 font-mono">
                              {new Date(att['Start Time']).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </td>
                            <td className="py-3 pr-4 font-mono">
                              {att['End Time']
                                ? new Date(att['End Time']).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                                : '—'}
                            </td>
                            <td className="py-3 pr-4 font-mono">
                              {att['Regular Hours'] || 0}h / {att['Overtime Hours'] || 0}h
                            </td>
                            <td className="py-3">
                              <span
                                className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                  att.Status === 'Completed'
                                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                    : 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                                }`}
                              >
                                {att.Status}
                              </span>
                            </td>
                          </tr>
                        ))}
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
                                {Object.entries(dailyReport.bySite).map(([siteId, data]) => (
                                  <tr key={siteId} className="hover:bg-slate-800/30">
                                    <td className="py-3 px-4 font-mono text-blue-400 font-medium">{siteId}</td>
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
                                ))}
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
                                  <th className="py-2.5 px-4">Employee ID</th>
                                  <th className="py-2.5 px-4">Employee Name</th>
                                  <th className="py-2.5 px-4">Shifts</th>
                                  <th className="py-2.5 px-4">Regular Hrs</th>
                                  <th className="py-2.5 px-4">Overtime Hrs</th>
                                  <th className="py-2.5 px-4">Total Hrs</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-800">
                                {Object.entries(dailyReport.byEmployee).map(([empId, data]) => (
                                  <tr key={empId} className="hover:bg-slate-800/30">
                                    <td className="py-3 px-4 font-mono text-blue-400 font-medium">{empId}</td>
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
                                ))}
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
                    onClick={() => setShowAddEmpModal(true)}
                    className="px-3.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-md shadow-blue-600/30 transition-all flex items-center gap-1.5 cursor-pointer"
                  >
                    <span>+</span>
                    <span>Register Labourer</span>
                  </button>
                </div>
                {employees.length === 0 ? (
                  <p className="text-sm text-slate-500 py-8 text-center">No employee records found in Google Sheets.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs text-slate-300">
                      <thead className="text-[10px] uppercase tracking-wider text-slate-400 border-b border-slate-700/80">
                        <tr>
                          <th className="py-2.5 pr-4">ID</th>
                          <th className="py-2.5 pr-4">Name</th>
                          <th className="py-2.5 pr-4">Role</th>
                          <th className="py-2.5 pr-4">Assigned Site</th>
                          <th className="py-2.5">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800">
                        {employees.map((emp) => (
                          <tr key={emp.id} className="hover:bg-slate-800/30">
                            <td className="py-3 pr-4 font-mono font-medium text-blue-400">{emp.id}</td>
                            <td className="py-3 pr-4 text-white font-medium">{emp.name}</td>
                            <td className="py-3 pr-4">{emp.role}</td>
                            <td className="py-3 pr-4 font-mono text-slate-400">{emp.siteId || 'Unassigned'}</td>
                            <td className="py-3">
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
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* 4. JOB SITES TAB */}
            {activeTab === 'sites' && (
              <div>
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">
                    Registered Job Sites & Geofences
                  </h2>
                  <button
                    onClick={() => setShowAddSiteModal(true)}
                    className="px-3.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-md shadow-blue-600/30 transition-all flex items-center gap-1.5 cursor-pointer"
                  >
                    <span>+</span>
                    <span>Add Job Site</span>
                  </button>
                </div>
                {sites.length === 0 ? (
                  <p className="text-sm text-slate-500 py-8 text-center">No job sites registered in Google Sheets.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs text-slate-300">
                      <thead className="text-[10px] uppercase tracking-wider text-slate-400 border-b border-slate-700/80">
                        <tr>
                          <th className="py-2.5 pr-4">Site ID</th>
                          <th className="py-2.5 pr-4">Site Name</th>
                          <th className="py-2.5 pr-4">Coordinates (Lat, Lon)</th>
                          <th className="py-2.5 pr-4">Geofence Radius</th>
                          <th className="py-2.5">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800">
                        {sites.map((site) => (
                          <tr key={site.ID} className="hover:bg-slate-800/30">
                            <td className="py-3 pr-4 font-mono font-medium text-blue-400">{site.ID}</td>
                            <td className="py-3 pr-4 text-white font-medium">{site.Name}</td>
                            <td className="py-3 pr-4 font-mono text-slate-400">
                              {site.Latitude}, {site.Longitude}
                            </td>
                            <td className="py-3 pr-4 font-mono">{site['Geofence Radius']}m</td>
                            <td className="py-3">
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                {site.Status}
                              </span>
                            </td>
                          </tr>
                        ))}
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

            <form onSubmit={handleCreateEmployee} className="space-y-4">
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
                  <option value="">Unassigned</option>
                  {sites.map((s) => (
                    <option key={s.ID} value={s.ID}>
                      {s.Name} ({s.ID})
                    </option>
                  ))}
                </select>
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
                  onClick={() => setShowAddEmpModal(false)}
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

      {/* Add Job Site Modal */}
      {showAddSiteModal && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="glass-panel bg-slate-900 border border-slate-700 rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl">
            <h3 className="text-lg font-bold text-white mb-2">Create New Job Site</h3>
            <p className="text-xs text-slate-400 mb-6">
              Defines site GPS center coordinates and geofence enforcement radius for clock-in verification.
            </p>

            <form onSubmit={handleCreateJobSite} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
                  Site Name
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Dubai Marina Tower Phase 2"
                  value={newSiteName}
                  onChange={(e) => setNewSiteName(e.target.value)}
                  className="w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
                  Address / Location Notes
                </label>
                <input
                  type="text"
                  placeholder="e.g. Dubai Marina, UAE"
                  value={newSiteAddress}
                  onChange={(e) => setNewSiteAddress(e.target.value)}
                  className="w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
                    Latitude
                  </label>
                  <input
                    type="number"
                    step="any"
                    required
                    placeholder="25.2533"
                    value={newSiteLat}
                    onChange={(e) => setNewSiteLat(e.target.value)}
                    className="w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
                    Longitude
                  </label>
                  <input
                    type="number"
                    step="any"
                    required
                    placeholder="55.3652"
                    value={newSiteLon}
                    onChange={(e) => setNewSiteLon(e.target.value)}
                    className="w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
                  Geofence Radius (Meters)
                </label>
                <input
                  type="number"
                  min="30"
                  max="1000"
                  required
                  placeholder="100"
                  value={newSiteRadius}
                  onChange={(e) => setNewSiteRadius(e.target.value)}
                  className="w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowAddSiteModal(false)}
                  className="flex-1 py-2.5 rounded-xl text-xs font-semibold text-slate-300 bg-slate-800 hover:bg-slate-700 border border-slate-700 transition-all cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingModal}
                  className="flex-1 py-2.5 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 shadow-lg shadow-blue-600/30 transition-all disabled:opacity-50 cursor-pointer"
                >
                  {submittingModal ? 'Saving...' : 'Save Job Site'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Change PIN Modal */}
      <ChangePinModal
        token={session.token}
        isOpen={showPinModal}
        onClose={() => setShowPinModal(false)}
        onSuccess={() => setActionMessage({ type: 'success', text: 'Administrator PIN updated successfully!' })}
      />
    </div>
  );
}
