import React, { useState, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import {
  UserSession,
  ShiftRecord,
  EmployeeProfile,
  DashboardResponse,
  getDashboardData,
  startShift,
  endShift,
} from '@/lib/api';
import {
  getCurrentPosition,
  categorizeAccuracy,
  calculateDistanceMeters,
  GpsCoordinates,
} from '@/lib/geo';
import ChangePinModal from '@/components/ChangePinModal';

const LiveLocationMap = dynamic(() => import('@/components/LiveLocationMap'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-64 rounded-2xl bg-slate-800/60 flex items-center justify-center text-slate-400 text-xs">
      Loading live location map...
    </div>
  ),
});

const GeofenceMap = dynamic(() => import('@/components/GeofenceMap'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-64 rounded-2xl bg-slate-800/60 flex items-center justify-center text-slate-400 text-xs">
      Loading interactive site geofence map...
    </div>
  ),
});

interface LabourerDashboardProps {
  session: UserSession;
  onLogout: () => void;
}

export default function LabourerDashboard({ session, onLogout }: LabourerDashboardProps) {
  const [employeeProfile, setEmployeeProfile] = useState<EmployeeProfile>(session.employee);
  const [shifts, setShifts] = useState<ShiftRecord[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [activeShift, setActiveShift] = useState<ShiftRecord | null>(null);

  // GPS state
  const [gps, setGps] = useState<GpsCoordinates | null>(null);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [showMap, setShowMap] = useState<boolean>(true);

  // Action states
  const [actionLoading, setActionLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [breakMinutes, setBreakMinutes] = useState(60);
  const [showPinModal, setShowPinModal] = useState(false);

  // Derived site info
  const assignedSiteId = (employeeProfile.siteId || '').trim();
  const hasAssignedSite = Boolean(assignedSiteId && assignedSiteId !== 'FIELD' && assignedSiteId !== 'Unassigned');
  const siteLat = employeeProfile.siteLat != null ? Number(employeeProfile.siteLat) : null;
  const siteLon = employeeProfile.siteLon != null ? Number(employeeProfile.siteLon) : null;
  const geofenceRadius = employeeProfile.geofenceRadius || 100;

  const distanceMeters = (gps && siteLat != null && siteLon != null)
    ? calculateDistanceMeters(gps.lat, gps.lon, siteLat, siteLon)
    : null;
  const isInsideGeofence = distanceMeters != null ? distanceMeters <= geofenceRadius : false;

  // Load employee profile & active shifts — single GAS round-trip
  const loadData = useCallback(async () => {
    setLoadingData(true);
    try {
      const res: DashboardResponse = await getDashboardData(session.token, session.employee.id);
      if (res.success) {
        if (res.employee) {
          setEmployeeProfile(res.employee);
        }
        if (Array.isArray(res.shifts)) {
          setShifts(res.shifts);
          setActiveShift(res.activeShift ?? null);
        }
      }
    } catch (err: unknown) {
      console.error('Failed to load dashboard data:', err);
    } finally {
      setLoadingData(false);
    }
  }, [session.token, session.employee.id]);


  // GPS Acquisition
  const acquireGps = useCallback(async () => {
    setGpsLoading(true);
    setGpsError(null);
    try {
      const coords = await getCurrentPosition(15000);
      setGps(coords);
      return coords;
    } catch (err: unknown) {
      const msg = (err as Error).message || 'Could not acquire GPS position. Please enable location permissions.';
      setGpsError(msg);
      return null;
    } finally {
      setGpsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    acquireGps();
  }, [loadData, acquireGps]);

  // Handle Start Shift (captures live GPS location directly with assigned site verification)
  const handleStartShift = async () => {
    if (!hasAssignedSite) {
      setActionMessage({
        type: 'error',
        text: 'No job site assigned. Please contact your supervisor.',
      });
      return;
    }

    // A shift action must capture a fresh position, never reuse the
    // position acquired when the dashboard first opened.
    const currentGps = await acquireGps();
    if (!currentGps) {
      setActionMessage({
        type: 'error',
        text: 'Please enable GPS access on your phone or browser to record your clock-in location.',
      });
      return;
    }

    // Check GPS accuracy tolerance (<= 30m)
    if (currentGps.accuracy > 30) {
      setActionMessage({
        type: 'error',
        text: `GPS signal accuracy (±${Math.round(currentGps.accuracy)}m) exceeds maximum allowable limit (30m). Please step into an open area for a stronger satellite lock.`,
      });
      return;
    }

    // Check geofence if site coordinates are configured
    if (siteLat != null && siteLon != null) {
      const dist = calculateDistanceMeters(currentGps.lat, currentGps.lon, siteLat, siteLon);
      if (dist > geofenceRadius) {
        setActionMessage({
          type: 'error',
          text: `Outside assigned work site (${dist}m away from ${employeeProfile.siteName || assignedSiteId}, allowed radius is ${geofenceRadius}m). You must be within the work site boundary to clock in.`,
        });
        return;
      }
    }

    setActionLoading(true);
    setActionMessage(null);

    try {
      const res = await startShift(session.token, session.employee.id, assignedSiteId, {
        lat: currentGps.lat,
        lon: currentGps.lon,
        accuracy: Math.round(currentGps.accuracy),
      });

      if (res.success && res.data?.shiftId) {
        // Update state optimistically from the response — no extra GAS round-trip needed
        const newShift: ShiftRecord = {
          ID: res.data.shiftId,
          'Employee ID': session.employee.id,
          'Site ID': assignedSiteId,
          'Start Time': new Date().toISOString(),
          'Start Latitude': currentGps.lat,
          'Start Longitude': currentGps.lon,
          'Start Accuracy': Math.round(currentGps.accuracy),
          'Break Minutes': 60,
          Status: 'Active',
          'Created At': new Date().toISOString(),
        };
        setActiveShift(newShift);
        setShifts((prev) => [newShift, ...prev]);
        setActionMessage({
          type: 'success',
          text: `Shift started successfully at ${employeeProfile.siteName || assignedSiteId}! Location recorded at ${currentGps.lat.toFixed(5)}, ${currentGps.lon.toFixed(5)}.`,
        });
      } else if (res.success) {
        // Fallback: refresh from server if response didn't include shiftId
        setActionMessage({
          type: 'success',
          text: `Shift started successfully at ${employeeProfile.siteName || assignedSiteId}!`,
        });
        await loadData();
      } else {
        setActionMessage({ type: 'error', text: res.message || 'Failed to start shift.' });
      }
    } catch (err: unknown) {
      setActionMessage({ type: 'error', text: (err as Error).message || 'Network error starting shift.' });
    } finally {
      setActionLoading(false);
    }
  };

  // Handle End Shift (captures live GPS location directly)
  const handleEndShift = async () => {
    // A shift action must capture a fresh position, never reuse the
    // position acquired when the dashboard first opened.
    const currentGps = await acquireGps();
    if (!currentGps) {
      setActionMessage({
        type: 'error',
        text: 'Please enable GPS access on your phone or browser to record your clock-out location.',
      });
      return;
    }

    setActionLoading(true);
    setActionMessage(null);

    try {
      const res = await endShift(
        session.token,
        session.employee.id,
        {
          lat: currentGps.lat,
          lon: currentGps.lon,
          accuracy: Math.round(currentGps.accuracy),
        },
        breakMinutes
      );

      if (res.success) {
        const otText = res.data?.overtimeHours ? ` (${res.data.overtimeHours} hrs overtime submitted for review)` : '';
        // Update state optimistically — mark the active shift as Completed without re-fetching
        if (activeShift) {
          const completedShift: ShiftRecord = {
            ...activeShift,
            'End Time': new Date().toISOString(),
            'End Latitude': currentGps.lat,
            'End Longitude': currentGps.lon,
            'End Accuracy': Math.round(currentGps.accuracy),
            'Regular Hours': 0,       // Will be accurate on next loadData
            'Overtime Hours': res.data?.overtimeHours ?? 0,
            Status: 'Completed',
          };
          setShifts((prev) => prev.map((s) => s.ID === activeShift.ID ? completedShift : s));
          setActiveShift(null);
        } else {
          await loadData();
        }

        setActionMessage({
          type: 'success',
          text: `Shift ended! Clock-out location recorded at ${currentGps.lat.toFixed(5)}, ${currentGps.lon.toFixed(5)}.${otText}`,
        });
      } else {
        setActionMessage({ type: 'error', text: res.message || 'Failed to end shift.' });
      }
    } catch (err: unknown) {
      setActionMessage({ type: 'error', text: (err as Error).message || 'Network error ending shift.' });
    } finally {
      setActionLoading(false);
    }
  };

  const accuracyBadge = gps ? categorizeAccuracy(gps.accuracy) : null;
  const canStartShift = !activeShift && !actionLoading;
  const canEndShift = Boolean(activeShift) && !actionLoading;

  return (
    <div className="flex-1 max-w-4xl w-full mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
      {/* Top Header Card */}
      <header className="glass-panel rounded-3xl p-5 sm:p-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400 font-bold text-lg">
              {session.employee.name.charAt(0)}
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-white">{session.employee.name}</h1>
              <p className="text-xs sm:text-sm text-slate-400">
                ID: <span className="font-mono text-blue-400 font-medium">{session.employee.id}</span> • Role:{' '}
                {session.employee.role} • Site:{' '}
                <span className={hasAssignedSite ? 'text-emerald-400 font-medium' : 'text-amber-400 font-medium'}>
                  {hasAssignedSite ? (employeeProfile.siteName || assignedSiteId) : 'Unassigned'}
                </span>
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowPinModal(true)}
            className="px-3.5 py-2 text-xs font-semibold uppercase tracking-wider text-slate-300 hover:text-white bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 rounded-xl transition-all cursor-pointer"
          >
            Change PIN
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

      {/* Assigned Job Site & Geofence Card */}
      {!hasAssignedSite ? (
        <section className="p-5 sm:p-6 rounded-3xl bg-amber-500/10 border border-amber-500/30 flex items-start gap-4 shadow-lg shadow-amber-500/5">
          <div className="w-10 h-10 rounded-2xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400 font-bold text-lg flex-shrink-0">
            ⚠️
          </div>
          <div className="flex-1">
            <h2 className="text-base font-bold text-amber-200">No Job Site Assigned</h2>
            <p className="text-xs sm:text-sm text-amber-300/90 mt-1">
              No job site assigned. Please contact your supervisor.
            </p>
            <p className="text-[11px] text-amber-400/80 mt-2">
              Your supervisor Ateeb can assign you to a job site from the Admin Dashboard at any time. Once assigned, you will be able to start your shift.
            </p>
          </div>
        </section>
      ) : (
        <section className="glass-card rounded-3xl p-5 sm:p-6 border-blue-500/20">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-lg">🏢</span>
                <h2 className="text-base font-bold text-white">
                  {employeeProfile.siteName || assignedSiteId}
                </h2>
                <span className="font-mono text-xs px-2 py-0.5 rounded-md bg-blue-500/10 text-blue-400 border border-blue-500/20">
                  {assignedSiteId}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                Approved Geofence Radius: <span className="font-mono text-slate-300 font-semibold">{geofenceRadius}m</span>
              </p>
            </div>

            {/* Geofence Status Badge */}
            {gps && (
              <div>
                {isInsideGeofence ? (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-300 border border-emerald-500/30 shadow-sm shadow-emerald-500/20">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    Within Work Site Geofence ({distanceMeters}m away)
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-300 border border-rose-500/30">
                    <span className="w-2 h-2 rounded-full bg-rose-400" />
                    Outside Site ({distanceMeters != null ? `${distanceMeters}m away` : 'Locating...'} • Allowed: {geofenceRadius}m)
                  </span>
                )}
              </div>
            )}
          </div>
        </section>
      )}

      {/* Main Grid: Shift Status & GPS Telemetry */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Attendance Status Card */}
        <section className="glass-card rounded-3xl p-6 flex flex-col justify-between">
          <div>
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Shift Status</h2>
              <span
                className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${
                  activeShift
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                    : 'bg-slate-800 text-slate-400 border border-slate-700'
                }`}
              >
                {activeShift ? 'Shift Active' : 'Off Shift'}
              </span>
            </div>

            {activeShift ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-emerald-400 font-bold text-lg">
                  <span className="w-3 h-3 rounded-full bg-emerald-400 animate-ping" />
                  <span>Clocked In</span>
                </div>
                <p className="text-xs text-slate-300">
                  Started at:{' '}
                  <span className="font-mono font-bold text-white">
                    {new Date(activeShift['Start Time']).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </p>
                {activeShift['Start Latitude'] && activeShift['Start Longitude'] && (
                  <p className="text-xs text-slate-400 font-mono">
                    Clock-in Location: {Number(activeShift['Start Latitude']).toFixed(5)},{' '}
                    {Number(activeShift['Start Longitude']).toFixed(5)}
                  </p>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-lg font-bold text-white">Ready to Clock In</p>
                <p className="text-xs text-slate-400">
                  Your exact GPS location and timestamp will be recorded when you press Start Shift.
                </p>
              </div>
            )}
          </div>

          <div className="mt-6 pt-4 border-t border-slate-700/60 text-xs text-slate-400 flex justify-between">
            <span>Total Shifts Logged:</span>
            <span className="font-mono text-white font-bold">{shifts.length}</span>
          </div>
        </section>

        {/* Live GPS Telemetry Card */}
        <section className="glass-card rounded-3xl p-6 flex flex-col justify-between">
          <div>
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Live GPS Status</h2>
              <button
                onClick={() => acquireGps()}
                disabled={gpsLoading}
                className="text-xs font-semibold text-blue-400 hover:text-blue-300 disabled:opacity-50 transition-colors flex items-center gap-1 cursor-pointer"
              >
                {gpsLoading ? 'Locating...' : '↻ Refresh GPS'}
              </button>
            </div>

            {gpsLoading ? (
              <div className="py-6 flex flex-col items-center justify-center text-center space-y-2">
                <div className="w-8 h-8 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
                <p className="text-sm text-slate-300">Acquiring live GPS position...</p>
                <p className="text-xs text-slate-500">Please allow browser location access</p>
              </div>
            ) : gpsError ? (
              <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">
                <p className="font-semibold mb-1">GPS Permission Needed:</p>
                <p>{gpsError}</p>
                <button
                  onClick={() => acquireGps()}
                  className="mt-3 px-3 py-1.5 rounded-lg bg-rose-500/20 text-rose-200 hover:bg-rose-500/30 font-medium"
                >
                  Enable Location
                </button>
              </div>
            ) : gps ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-400">GPS Precision:</span>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-md bg-slate-800 ${accuracyBadge?.color}`}>
                    {accuracyBadge?.label} (±{Math.round(gps.accuracy)}m)
                  </span>
                </div>

                <div className="p-3 rounded-2xl bg-slate-900/60 border border-slate-800">
                  <span className="text-[11px] text-slate-400 block mb-1">Current Coordinates</span>
                  <span className="text-sm font-mono text-emerald-400 font-bold">
                    📍 {gps.lat.toFixed(6)}, {gps.lon.toFixed(6)}
                  </span>
                </div>
              </div>
            ) : null}
          </div>

          <div className="mt-4 pt-3 border-t border-slate-700/60 text-[11px] text-slate-400">
            Location is recorded when you start and end your shift.
          </div>
        </section>
      </div>

      {/* Geofence or Live Location Map */}
      {(siteLat != null && siteLon != null) ? (
        <section className="glass-card rounded-3xl p-5 sm:p-6">
          <div className="flex justify-between items-center mb-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-300 flex items-center gap-2">
              <span>🗺️</span>
              <span>Job Site Geofence Boundary</span>
            </h2>
            <button
              onClick={() => setShowMap(!showMap)}
              className="text-xs text-blue-400 hover:text-blue-300 font-medium transition-colors"
            >
              {showMap ? 'Hide Map' : 'Show Map'}
            </button>
          </div>
          {showMap && (
            <GeofenceMap
              siteLat={siteLat}
              siteLon={siteLon}
              siteName={employeeProfile.siteName || assignedSiteId}
              geofenceRadius={geofenceRadius}
              userLat={gps?.lat}
              userLon={gps?.lon}
              userAccuracy={gps?.accuracy}
              insideGeofence={isInsideGeofence}
            />
          )}
        </section>
      ) : gps ? (
        <section className="glass-card rounded-3xl p-5 sm:p-6">
          <div className="flex justify-between items-center mb-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-300 flex items-center gap-2">
              <span>🗺️</span>
              <span>Your Live Location Map</span>
            </h2>
            <button
              onClick={() => setShowMap(!showMap)}
              className="text-xs text-blue-400 hover:text-blue-300 font-medium transition-colors"
            >
              {showMap ? 'Hide Map' : 'Show Map'}
            </button>
          </div>
          {showMap && (
            <LiveLocationMap
              userLat={gps.lat}
              userLon={gps.lon}
              userAccuracy={gps.accuracy}
              height="260px"
              label={`${session.employee.name}'s Location`}
            />
          )}
        </section>
      ) : null}

      {/* Large Action Buttons (START / END SHIFT) */}
      <section className="glass-panel rounded-3xl p-6 sm:p-8">
        {!activeShift ? (
          <div>
            <div className="text-center mb-6">
              <h2 className="text-xl font-bold text-white">Start Your Daily Shift</h2>
              <p className="text-xs text-slate-400 mt-1">
                Your clock-in timestamp and live location will be recorded to the company attendance ledger.
              </p>
            </div>

            {!hasAssignedSite && (
              <div className="p-3 mb-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs text-center font-medium">
                ⚠️ No job site assigned. Please contact your supervisor before starting shift.
              </div>
            )}

            <button
              onClick={handleStartShift}
              disabled={!canStartShift}
              className={`w-full py-5 rounded-2xl text-lg font-bold tracking-wide transition-all shadow-xl flex items-center justify-center gap-3 ${
                canStartShift
                  ? 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white glow-emerald cursor-pointer active:scale-[0.99]'
                  : 'bg-slate-800 text-slate-500 border border-slate-700/80 cursor-not-allowed opacity-60'
              }`}
            >
              {actionLoading ? (
                <>
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Recording Shift Start...</span>
                </>
              ) : (
                <>
                  <span className="text-2xl">▶</span>
                  <span>START SHIFT</span>
                </>
              )}
            </button>
          </div>
        ) : (
          <div>
            <div className="text-center mb-6">
              <h2 className="text-xl font-bold text-rose-400">End Active Shift</h2>
              <p className="text-xs text-slate-400 mt-1">
                Your clock-out timestamp and live location will be recorded. Overtime will be calculated automatically.
              </p>
            </div>

            {/* Break Minutes Selector */}
            <div className="max-w-xs mx-auto mb-6">
              <label
                htmlFor="breakDuration"
                className="block text-xs font-semibold uppercase tracking-wider text-slate-300 text-center mb-2"
              >
                Unpaid Break Taken (Minutes)
              </label>
              <div className="grid grid-cols-3 gap-2">
                {[30, 45, 60].map((mins) => (
                  <button
                    key={mins}
                    type="button"
                    onClick={() => setBreakMinutes(mins)}
                    className={`py-2 text-xs font-semibold rounded-xl border transition-all ${
                      breakMinutes === mins
                        ? 'bg-blue-600 text-white border-blue-500'
                        : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                    }`}
                  >
                    {mins} mins
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={handleEndShift}
              disabled={!canEndShift}
              className={`w-full py-5 rounded-2xl text-lg font-bold tracking-wide transition-all shadow-xl flex items-center justify-center gap-3 ${
                canEndShift
                  ? 'bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500 text-white shadow-rose-600/30 cursor-pointer active:scale-[0.99]'
                  : 'bg-slate-800 text-slate-500 border border-slate-700/80 cursor-not-allowed opacity-60'
              }`}
            >
              {actionLoading ? (
                <>
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Recording Shift End...</span>
                </>
              ) : (
                <>
                  <span className="text-2xl">⏹</span>
                  <span>END SHIFT & CLOCK OUT</span>
                </>
              )}
            </button>
          </div>
        )}
      </section>

      {/* Recent Shifts Section */}
      <section className="glass-card rounded-3xl p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400 mb-4">Your Recent Shifts</h2>
        {loadingData ? (
          <p className="text-xs text-slate-400 animate-pulse">Loading attendance history...</p>
        ) : shifts.length === 0 ? (
          <p className="text-xs text-slate-500 py-4 text-center">No previous shift records logged yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="text-[10px] uppercase tracking-wider text-slate-400 border-b border-slate-700/80">
                <tr>
                  <th className="py-2.5 pr-4">Date</th>
                  <th className="py-2.5 pr-4">Clock In</th>
                  <th className="py-2.5 pr-4">Clock Out</th>
                  <th className="py-2.5 pr-4">Regular</th>
                  <th className="py-2.5 pr-4">Overtime</th>
                  <th className="py-2.5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {shifts.slice(0, 5).map((s) => {
                  const sLat = s['Start Latitude'];
                  const sLon = s['Start Longitude'];
                  const eLat = s['End Latitude'];
                  const eLon = s['End Longitude'];

                  return (
                    <tr key={s.ID} className="hover:bg-slate-800/40">
                      <td className="py-3 pr-4 font-mono">{new Date(s['Start Time']).toLocaleDateString()}</td>
                      <td className="py-3 pr-4 font-mono">
                        <div>
                          {new Date(s['Start Time']).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                        {sLat && sLon ? (
                          <a
                            href={`https://www.google.com/maps?q=${sLat},${sLon}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[10px] text-emerald-400 hover:underline inline-flex items-center gap-0.5 mt-0.5"
                          >
                            <span>📍</span>
                            <span>
                              {Number(sLat).toFixed(4)}, {Number(sLon).toFixed(4)}
                            </span>
                          </a>
                        ) : null}
                      </td>
                      <td className="py-3 pr-4 font-mono">
                        {s['End Time'] ? (
                          <>
                            <div>
                              {new Date(s['End Time']).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </div>
                            {eLat && eLon ? (
                              <a
                                href={`https://www.google.com/maps?q=${eLat},${eLon}`}
                                target="_blank"
                                rel="noreferrer"
                                className="text-[10px] text-emerald-400 hover:underline inline-flex items-center gap-0.5 mt-0.5"
                              >
                                <span>📍</span>
                                <span>
                                  {Number(eLat).toFixed(4)}, {Number(eLon).toFixed(4)}
                                </span>
                              </a>
                            ) : null}
                          </>
                        ) : (
                          <span className="text-amber-400 font-semibold">Active</span>
                        )}
                      </td>
                      <td className="py-3 pr-4 font-mono">{s['Regular Hours'] ?? '—'}h</td>
                      <td className="py-3 pr-4 font-mono font-semibold text-blue-400">
                        {s['Overtime Hours'] ? `${s['Overtime Hours']}h` : '0h'}
                      </td>
                      <td className="py-3">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            s.Status === 'Completed'
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                              : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                          }`}
                        >
                          {s.Status}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Change PIN Modal */}
      <ChangePinModal
        token={session.token}
        isOpen={showPinModal}
        onClose={() => setShowPinModal(false)}
        onSuccess={() => setActionMessage({ type: 'success', text: 'Security PIN updated successfully!' })}
      />
    </div>
  );
}
