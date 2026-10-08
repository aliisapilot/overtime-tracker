import React, { useState, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import {
  UserSession,
  JobSite,
  ShiftRecord,
  getEmployeeData,
  getEmployeeShifts,
  startShift,
  endShift,
} from '@/lib/api';
import {
  getCurrentPosition,
  categorizeAccuracy,
  calculateDistanceMeters,
  GpsCoordinates,
} from '@/lib/geo';

const GeofenceMap = dynamic(() => import('@/components/GeofenceMap'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-64 sm:h-80 rounded-2xl bg-slate-800/60 flex items-center justify-center text-slate-400 text-xs">
      Loading interactive geofence map...
    </div>
  ),
});

interface LabourerDashboardProps {
  session: UserSession;
  onLogout: () => void;
}

export default function LabourerDashboard({ session, onLogout }: LabourerDashboardProps) {
  const [jobSite, setJobSite] = useState<JobSite | null>(null);
  const [shifts, setShifts] = useState<ShiftRecord[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [activeShift, setActiveShift] = useState<ShiftRecord | null>(null);

  // GPS state
  const [gps, setGps] = useState<GpsCoordinates | null>(null);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [distanceToSite, setDistanceToSite] = useState<number | null>(null);
  const [insideGeofence, setInsideGeofence] = useState<boolean>(false);
  const [showMap, setShowMap] = useState<boolean>(true);

  // Action states
  const [actionLoading, setActionLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [breakMinutes, setBreakMinutes] = useState(60);

  // Load employee profile & assigned site
  const loadData = useCallback(async () => {
    setLoadingData(true);
    try {
      const [empRes, shiftsRes] = await Promise.all([
        getEmployeeData(session.token, session.employee.id),
        getEmployeeShifts(session.token, session.employee.id),
      ]);

      if (empRes.success && empRes.jobSite) {
        setJobSite(empRes.jobSite as JobSite);
      }

      if (shiftsRes.success && Array.isArray(shiftsRes.shifts)) {
        setShifts(shiftsRes.shifts);
        // Look for active shift (Status === 'Active' or missing End Time)
        const currentActive = shiftsRes.shifts.find(
          (s) => s.Status === 'Active' || (!s['End Time'] && s.Status !== 'Completed')
        );
        setActiveShift(currentActive || null);
      }
    } catch (err: unknown) {
      console.error('Failed to load dashboard data:', err);
    } finally {
      setLoadingData(false);
    }
  }, [session.token, session.employee.id]);

  // GPS Acquisition
  const acquireGps = useCallback(async (siteRef?: JobSite | null) => {
    setGpsLoading(true);
    setGpsError(null);
    try {
      const coords = await getCurrentPosition(15000);
      setGps(coords);

      const targetSite = siteRef || jobSite;
      if (targetSite && targetSite.Latitude && targetSite.Longitude) {
        const dist = calculateDistanceMeters(
          coords.lat,
          coords.lon,
          Number(targetSite.Latitude),
          Number(targetSite.Longitude)
        );
        setDistanceToSite(dist);
        const radius = Number(targetSite['Geofence Radius']) || 100;
        setInsideGeofence(dist <= radius);
      }
    } catch (err: unknown) {
      setGpsError((err as Error).message || 'Could not acquire GPS position');
    } finally {
      setGpsLoading(false);
    }
  }, [jobSite]);

  useEffect(() => {
    loadData();
    acquireGps();
  }, [loadData, acquireGps]);

  // Recalculate distance whenever GPS or JobSite changes
  useEffect(() => {
    if (gps && jobSite && jobSite.Latitude && jobSite.Longitude) {
      const dist = calculateDistanceMeters(
        gps.lat,
        gps.lon,
        Number(jobSite.Latitude),
        Number(jobSite.Longitude)
      );
      setDistanceToSite(dist);
      const radius = Number(jobSite['Geofence Radius']) || 100;
      setInsideGeofence(dist <= radius);
    }
  }, [gps, jobSite]);

  // Handle Start Shift
  const handleStartShift = async () => {
    if (!gps) {
      setActionMessage({ type: 'error', text: 'Please acquire a GPS lock before starting shift.' });
      return;
    }
    if (gps.accuracy > 30) {
      setActionMessage({
        type: 'error',
        text: `GPS accuracy is ±${Math.round(gps.accuracy)}m. Must be within 30m. Please step outside and refresh GPS.`,
      });
      return;
    }
    if (!jobSite) {
      setActionMessage({ type: 'error', text: 'No assigned job site configured for this account.' });
      return;
    }
    if (!insideGeofence) {
      setActionMessage({
        type: 'error',
        text: `You are ${distanceToSite}m away from ${jobSite.Name}. You must be inside the ${jobSite['Geofence Radius']}m site geofence.`,
      });
      return;
    }

    setActionLoading(true);
    setActionMessage(null);

    try {
      const res = await startShift(session.token, session.employee.id, jobSite.ID, {
        lat: gps.lat,
        lon: gps.lon,
        accuracy: Math.round(gps.accuracy),
      });

      if (res.success) {
        setActionMessage({ type: 'success', text: 'Shift started successfully! Clock-in recorded in Google Sheets.' });
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

  // Handle End Shift
  const handleEndShift = async () => {
    if (!gps) {
      setActionMessage({ type: 'error', text: 'Please acquire a GPS lock before ending shift.' });
      return;
    }
    if (gps.accuracy > 30) {
      setActionMessage({
        type: 'error',
        text: `GPS accuracy is ±${Math.round(gps.accuracy)}m. Must be within 30m. Please step outside and refresh GPS.`,
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
          lat: gps.lat,
          lon: gps.lon,
          accuracy: Math.round(gps.accuracy),
        },
        breakMinutes
      );

      if (res.success) {
        const otText = res.overtimeHours ? ` (${res.overtimeHours} hrs overtime submitted for review)` : '';
        setActionMessage({
          type: 'success',
          text: `Shift ended successfully!${otText}`,
        });
        await loadData();
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
  const canStartShift =
    !activeShift &&
    gps &&
    gps.accuracy <= 30 &&
    insideGeofence &&
    !actionLoading &&
    !gpsLoading;

  const canEndShift =
    !!activeShift &&
    gps &&
    gps.accuracy <= 30 &&
    !actionLoading &&
    !gpsLoading;

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
                ID: <span className="font-mono text-blue-400 font-medium">{session.employee.id}</span> • Role: {session.employee.role}
              </p>
            </div>
          </div>
        </div>
        <button
          onClick={onLogout}
          className="px-4 py-2 text-xs font-semibold uppercase tracking-wider text-slate-300 hover:text-white bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 rounded-xl transition-all"
        >
          Sign Out
        </button>
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
          <button
            onClick={() => setActionMessage(null)}
            className="text-xs uppercase opacity-70 hover:opacity-100"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Main Grid: Status & GPS Telemetry */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Assigned Job Site Card */}
        <section className="glass-card rounded-3xl p-6 flex flex-col justify-between">
          <div>
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Assigned Job Site</h2>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20">
                {jobSite ? jobSite.ID : 'Unassigned'}
              </span>
            </div>
            {jobSite ? (
              <div className="space-y-3">
                <p className="text-xl font-bold text-white">{jobSite.Name}</p>
                <p className="text-sm text-slate-400">{jobSite.Address || 'Dubai, UAE'}</p>
                <div className="pt-2 text-xs text-slate-400 space-y-1">
                  <p>Geofence Radius: <span className="font-mono text-slate-200">{jobSite['Geofence Radius']}m</span></p>
                  <p>Target Coordinates: <span className="font-mono text-slate-200">{jobSite.Latitude}, {jobSite.Longitude}</span></p>
                </div>
              </div>
            ) : loadingData ? (
              <p className="text-sm text-slate-400 animate-pulse">Loading assigned site...</p>
            ) : (
              <p className="text-sm text-amber-400">No active job site assigned to your account. Contact supervisor Ateeb.</p>
            )}
          </div>

          {/* Shift State Indicator */}
          <div className="mt-6 pt-4 border-t border-slate-700/60">
            <span className="text-xs text-slate-400 block mb-1">Current Attendance State</span>
            {activeShift ? (
              <div className="flex items-center gap-2 text-emerald-400 font-semibold">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
                <span>Shift IN PROGRESS (Started at {new Date(activeShift['Start Time']).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-slate-400 font-medium">
                <span className="w-2.5 h-2.5 rounded-full bg-slate-500" />
                <span>OFF SHIFT (Ready to Clock In)</span>
              </div>
            )}
          </div>
        </section>

        {/* GPS Geofence Telemetry Card */}
        <section className="glass-card rounded-3xl p-6 flex flex-col justify-between">
          <div>
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">GPS & Geofence Status</h2>
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
                <p className="text-sm text-slate-300">Acquiring high-precision GPS telemetry...</p>
                <p className="text-xs text-slate-500">Please ensure device location services are active</p>
              </div>
            ) : gpsError ? (
              <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">
                <p className="font-semibold mb-1">GPS Acquisition Error:</p>
                <p>{gpsError}</p>
                <button
                  onClick={() => acquireGps()}
                  className="mt-3 px-3 py-1.5 rounded-lg bg-rose-500/20 text-rose-200 hover:bg-rose-500/30 font-medium"
                >
                  Retry Location Check
                </button>
              </div>
            ) : gps ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-400">Accuracy Category:</span>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-md bg-slate-800 ${accuracyBadge?.color}`}>
                    {accuracyBadge?.label}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-400">Distance to Site:</span>
                  <span className="text-sm font-mono text-white font-semibold">
                    {distanceToSite !== null ? `${distanceToSite} meters` : 'Calculating...'}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-400">Geofence Compliance:</span>
                  <span
                    className={`text-xs font-bold px-2.5 py-0.5 rounded-full ${
                      insideGeofence
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                        : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                    }`}
                  >
                    {insideGeofence ? '✓ Inside Site Boundary' : '✗ Outside Site Boundary'}
                  </span>
                </div>

                <div className="pt-2 text-xs text-slate-500">
                  Current GPS: <span className="font-mono">{gps.lat.toFixed(5)}, {gps.lon.toFixed(5)}</span>
                </div>
              </div>
            ) : null}
          </div>

          <div className="mt-4 pt-3 border-t border-slate-700/60 text-xs text-slate-400">
            Rule: GPS accuracy must be ≤ 30m and location must be inside the site boundary to clock in.
          </div>
        </section>
      </div>

      {/* Interactive Geofence Map */}
      {jobSite && jobSite.Latitude && jobSite.Longitude && (
        <section className="glass-card rounded-3xl p-5 sm:p-6">
          <div className="flex justify-between items-center mb-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-300 flex items-center gap-2">
              <span>🗺️</span>
              <span>Site Geofence Map (OpenStreetMap)</span>
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
              siteLat={Number(jobSite.Latitude)}
              siteLon={Number(jobSite.Longitude)}
              siteName={jobSite.Name}
              geofenceRadius={Number(jobSite['Geofence Radius']) || 100}
              userLat={gps ? gps.lat : undefined}
              userLon={gps ? gps.lon : undefined}
              userAccuracy={gps ? gps.accuracy : undefined}
              insideGeofence={insideGeofence}
            />
          )}
        </section>
      )}

      {/* Large Action Buttons (START / END SHIFT) */}
      <section className="glass-panel rounded-3xl p-6 sm:p-8">
        {!activeShift ? (
          <div>
            <div className="text-center mb-6">
              <h2 className="text-xl font-bold text-white">Start Your Daily Shift</h2>
              <p className="text-xs text-slate-400 mt-1">
                Your clock-in timestamp and GPS location will be securely logged to the company attendance ledger.
              </p>
            </div>

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

            {!canStartShift && (
              <div className="mt-4 text-center text-xs text-amber-400/90 space-y-1">
                {!gps && <p>• Acquiring GPS location...</p>}
                {gps && gps.accuracy > 30 && (
                  <p>• GPS accuracy (±{Math.round(gps.accuracy)}m) is too poor. Must be ≤ 30m. Move to open sky.</p>
                )}
                {gps && !insideGeofence && (
                  <p>• You are {distanceToSite}m from site. You must be inside the geofence to start your shift.</p>
                )}
              </div>
            )}
          </div>
        ) : (
          <div>
            <div className="text-center mb-6">
              <h2 className="text-xl font-bold text-rose-400">End Active Shift</h2>
              <p className="text-xs text-slate-400 mt-1">
                Record your clock-out time. Overtime beyond standard 8 hours will be calculated automatically.
              </p>
            </div>

            {/* Break Minutes Selector */}
            <div className="max-w-xs mx-auto mb-6">
              <label htmlFor="breakDuration" className="block text-xs font-semibold uppercase tracking-wider text-slate-300 text-center mb-2">
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
                  ? 'bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500 text-white glow-rose cursor-pointer active:scale-[0.99]'
                  : 'bg-slate-800 text-slate-500 border border-slate-700/80 cursor-not-allowed opacity-60'
              }`}
            >
              {actionLoading ? (
                <>
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Recording Shift End & Calculating Overtime...</span>
                </>
              ) : (
                <>
                  <span className="text-2xl">⏹</span>
                  <span>END SHIFT</span>
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
                {shifts.slice(0, 5).map((s) => (
                  <tr key={s.ID} className="hover:bg-slate-800/40">
                    <td className="py-3 pr-4 font-mono">
                      {new Date(s['Start Time']).toLocaleDateString()}
                    </td>
                    <td className="py-3 pr-4 font-mono">
                      {new Date(s['Start Time']).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="py-3 pr-4 font-mono">
                      {s['End Time']
                        ? new Date(s['End Time']).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                        : '—'}
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
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
