import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  EmployeeProfile,
  ShiftRecord,
  startShift,
  endShift,
  uploadAttendancePhoto,
} from '@/lib/api';
import {
  getCurrentPosition,
  categorizeAccuracy,
  calculateDistanceMeters,
  GpsCoordinates,
} from '@/lib/geo';

interface SelfieModalProps {
  isOpen: boolean;
  type: 'start' | 'end';
  employee: EmployeeProfile;
  sessionToken: string;
  assignedSiteName?: string;
  siteLat?: number | null;
  siteLon?: number | null;
  geofenceRadius?: number;
  breakMinutes?: number;
  onSuccess: (shiftRecord: ShiftRecord) => void;
  onClose: () => void;
}

type ModalStep = 'gps' | 'gps_error' | 'camera' | 'preview' | 'submitting' | 'success';

export default function SelfieModal({
  isOpen,
  type,
  employee,
  sessionToken,
  assignedSiteName,
  siteLat,
  siteLon,
  geofenceRadius = 100,
  breakMinutes = 60,
  onSuccess,
  onClose,
}: SelfieModalProps) {
  const [step, setStep] = useState<ModalStep>('gps');
  const [gps, setGps] = useState<GpsCoordinates | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [capturedAt, setCapturedAt] = useState<string | null>(null);
  const [submittingStatus, setSubmittingStatus] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const isMountedRef = useRef(true);

  // Stop all camera hardware resources
  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // ignore
        }
      });
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  // Safe close handler that stops all hardware streams
  const handleSafeClose = useCallback(() => {
    stopCamera();
    onClose();
  }, [stopCamera, onClose]);

  // Acquire fresh GPS with maximumAge: 0
  const acquireFreshGps = useCallback(async () => {
    setStep('gps');
    setGpsError(null);
    setErrorMessage(null);

    try {
      // UAE Requirement: Fresh location with timeout and maximumAge: 0
      const coords = await getCurrentPosition(15000);
      setGps(coords);

      // Validate accuracy tolerance (<= 30m)
      if (coords.accuracy > 30) {
        setGpsError(
          `GPS accuracy (±${Math.round(coords.accuracy)}m) exceeds maximum allowable limit of 30 metres. Please step into an open area for a stronger satellite lock.`
        );
        setStep('gps_error');
        return;
      }

      // If starting shift, validate assigned job site geofence
      if (type === 'start') {
        const hasSiteCoords = siteLat != null && siteLon != null;
        if (!hasSiteCoords) {
          setGpsError('Assigned job site does not have registered GPS coordinates. Please contact your supervisor.');
          setStep('gps_error');
          return;
        }

        const distance = calculateDistanceMeters(coords.lat, coords.lon, siteLat, siteLon);
        if (distance > geofenceRadius) {
          setGpsError(
            `Outside assigned job site boundary (${distance}m away from ${assignedSiteName || 'Site'}, permitted radius is ${geofenceRadius}m). You must be within the work site boundary to clock in.`
          );
          setStep('gps_error');
          return;
        }
      }

      // GPS verified -> proceed to camera
      setStep('camera');
    } catch (err: unknown) {
      setGpsError((err as Error).message || 'Failed to acquire fresh GPS coordinates.');
      setStep('gps_error');
    }
  }, [type, siteLat, siteLon, geofenceRadius, assignedSiteName]);

  // Start front-facing camera
  const startCamera = useCallback(async (mode: 'user' | 'environment' = 'user') => {
    stopCamera();
    setCameraError(null);

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setCameraError('Camera access is not supported by your browser or device.');
      return;
    }

    try {
      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: mode,
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
    } catch (err: unknown) {
      const errorMsg = (err as Error).name === 'NotAllowedError'
        ? 'Camera permission denied. Please allow camera access in your device/browser settings.'
        : 'Unable to access camera. Please check your camera permissions.';
      setCameraError(errorMsg);
    }
  }, [stopCamera]);

  // Trigger GPS acquisition whenever modal opens
  useEffect(() => {
    isMountedRef.current = true;
    if (isOpen) {
      setCapturedImage(null);
      setCapturedAt(null);
      setErrorMessage(null);
      acquireFreshGps();
    }
    return () => {
      isMountedRef.current = false;
      stopCamera();
    };
  }, [isOpen, acquireFreshGps, stopCamera]);

  // Start camera when entering camera step
  useEffect(() => {
    if (step === 'camera') {
      startCamera(facingMode);
    } else {
      stopCamera();
    }
  }, [step, facingMode, startCamera, stopCamera]);

  // Capture selfie and compress via canvas
  const handleCapturePhoto = () => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    if (video.videoWidth === 0 || video.videoHeight === 0) return;

    const canvas = document.createElement('canvas');
    // Scale down to max 1024px maintaining aspect ratio
    const MAX_DIM = 1024;
    let width = video.videoWidth;
    let height = video.videoHeight;

    if (width > height) {
      if (width > MAX_DIM) {
        height = Math.round((height * MAX_DIM) / width);
        width = MAX_DIM;
      }
    } else {
      if (height > MAX_DIM) {
        width = Math.round((width * MAX_DIM) / height);
        height = MAX_DIM;
      }
    }

    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Flip horizontally if using front-facing user camera for natural mirror feel
    if (facingMode === 'user') {
      ctx.translate(width, 0);
      ctx.scale(-1, 1);
    }

    ctx.drawImage(video, 0, 0, width, height);

    // Compress to high quality JPEG (~60-90 KB)
    const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.78);
    const timeNow = new Date().toISOString();

    setCapturedImage(compressedDataUrl);
    setCapturedAt(timeNow);
    stopCamera();
    setStep('preview');
  };

  // Flip camera between front and rear
  const handleToggleCamera = () => {
    const nextMode = facingMode === 'user' ? 'environment' : 'user';
    setFacingMode(nextMode);
  };

  // Retake photo
  const handleRetake = () => {
    setCapturedImage(null);
    setCapturedAt(null);
    setStep('camera');
  };

  // Confirm and save shift
  const handleConfirmAndSave = async () => {
    if (!capturedImage || !gps) return;

    setStep('submitting');
    setErrorMessage(null);
    setSubmittingStatus('Securing attendance selfie in private storage...');

    try {
      // Step 1: Upload photo securely to Cloudflare R2
      const uploadRes = await uploadAttendancePhoto(
        sessionToken,
        employee.id,
        capturedImage,
        type,
        capturedAt || new Date().toISOString()
      );

      if (!uploadRes.success || !uploadRes.photoKey) {
        throw new Error(uploadRes.message || 'Photo upload failed. Please retake and try again.');
      }

      setSubmittingStatus('Recording verified GPS & shift to ledger...');

      // Step 2: Save shift record to Google Apps Script backend
      if (type === 'start') {
        const siteId = employee.siteId || '';
        const res = await startShift(
          sessionToken,
          employee.id,
          siteId,
          {
            lat: gps.lat,
            lon: gps.lon,
            accuracy: Math.round(gps.accuracy),
          },
          {
            photoKey: uploadRes.photoKey,
            photoProof: uploadRes.photoProof,
            photoCapturedAt: uploadRes.capturedAt,
          }
        );

        if (!res.success || !res.data?.shiftId) {
          throw new Error(res.message || 'Failed to start shift on server.');
        }

        const newShift: ShiftRecord = {
          ID: res.data.shiftId,
          'Employee ID': employee.id,
          'Site ID': siteId,
          'Start Time': new Date().toISOString(),
          'Start Latitude': gps.lat,
          'Start Longitude': gps.lon,
          'Start Accuracy': Math.round(gps.accuracy),
          'Break Minutes': 60,
          Status: 'Active',
          'Created At': new Date().toISOString(),
          'Start Photo Key': uploadRes.photoKey,
          startPhotoKey: uploadRes.photoKey,
          'Start Photo Captured At': uploadRes.capturedAt,
          'Start Photo Verification Status': 'Verified',
          startPhotoStatus: 'Verified',
        };

        setStep('success');
        setTimeout(() => {
          onSuccess(newShift);
          handleSafeClose();
        }, 1200);
      } else {
        // End Shift
        const res = await endShift(
          sessionToken,
          employee.id,
          {
            lat: gps.lat,
            lon: gps.lon,
            accuracy: Math.round(gps.accuracy),
          },
          {
            photoKey: uploadRes.photoKey,
            photoProof: uploadRes.photoProof,
            photoCapturedAt: uploadRes.capturedAt,
          },
          breakMinutes
        );

        if (!res.success || !res.data?.shiftId) {
          throw new Error(res.message || 'Failed to end shift on server.');
        }

        const completedShift: ShiftRecord = {
          ID: res.data.shiftId,
          'Employee ID': employee.id,
          'Site ID': employee.siteId || '',
          'Start Time': '',
          'End Time': new Date().toISOString(),
          'Start Latitude': 0,
          'Start Longitude': 0,
          'Start Accuracy': 0,
          'End Latitude': gps.lat,
          'End Longitude': gps.lon,
          'End Accuracy': Math.round(gps.accuracy),
          'Break Minutes': breakMinutes,
          'Overtime Hours': res.data.overtimeHours || 0,
          Status: 'Completed',
          'Created At': new Date().toISOString(),
          'End Photo Key': uploadRes.photoKey,
          endPhotoKey: uploadRes.photoKey,
          'End Photo Captured At': uploadRes.capturedAt,
          'End Photo Verification Status': 'Verified',
          endPhotoStatus: 'Verified',
        };

        setStep('success');
        setTimeout(() => {
          onSuccess(completedShift);
          handleSafeClose();
        }, 1200);
      }
    } catch (err: unknown) {
      setErrorMessage((err as Error).message || 'A network error occurred while submitting.');
      setStep('preview'); // Return to preview so employee does not have to retake
    }
  };

  if (!isOpen) return null;

  const accuracyBadge = gps ? categorizeAccuracy(gps.accuracy) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/85 backdrop-blur-md animate-fade-in">
      <div className="relative w-full max-w-md bg-slate-900 border border-slate-700/80 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/60">
          <div className="flex items-center gap-2.5">
            <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-sm font-bold ${
              type === 'start' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
            }`}>
              {type === 'start' ? '▶' : '■'}
            </div>
            <div>
              <h3 className="text-sm font-bold text-white tracking-wide">
                {type === 'start' ? 'Start Shift Verification' : 'End Shift Verification'}
              </h3>
              <p className="text-[11px] text-slate-400">
                Mandatory Selfie & Fresh GPS
              </p>
            </div>
          </div>
          <button
            onClick={handleSafeClose}
            disabled={step === 'submitting'}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 flex-1 overflow-y-auto space-y-4">
          {/* STEP 1: GPS ACQUISITION */}
          {step === 'gps' && (
            <div className="py-12 flex flex-col items-center justify-center text-center space-y-4">
              <div className="relative w-16 h-16 flex items-center justify-center">
                <div className="absolute inset-0 rounded-full border-2 border-emerald-500/30 animate-ping" />
                <div className="w-12 h-12 rounded-full bg-emerald-500/20 border border-emerald-500 flex items-center justify-center text-2xl">
                  🛰️
                </div>
              </div>
              <div className="space-y-1">
                <h4 className="text-sm font-semibold text-white">Acquiring Fresh GPS Coordinates...</h4>
                <p className="text-xs text-slate-400 max-w-xs">
                  Requesting satellite lock with zero cache (`maximumAge: 0`). Please allow a moment.
                </p>
              </div>
            </div>
          )}

          {/* STEP 2: GPS ERROR OR MISMATCH */}
          {step === 'gps_error' && (
            <div className="py-6 flex flex-col items-center text-center space-y-4">
              <div className="w-14 h-14 rounded-2xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-center text-2xl text-rose-400">
                ⚠️
              </div>
              <div className="space-y-1.5">
                <h4 className="text-sm font-semibold text-rose-300">Location Verification Failed</h4>
                <p className="text-xs text-slate-300 bg-rose-500/10 border border-rose-500/20 p-3 rounded-xl text-left leading-relaxed">
                  {gpsError}
                </p>
              </div>

              {gps && (
                <div className="w-full bg-slate-800/60 border border-slate-700/60 rounded-xl p-3 text-xs text-slate-400 space-y-1 font-mono text-left">
                  <div>Reading: {gps.lat.toFixed(5)}, {gps.lon.toFixed(5)}</div>
                  <div className={accuracyBadge?.color || ''}>Accuracy: ±{Math.round(gps.accuracy)}m ({accuracyBadge?.level})</div>
                  <div>Max Allowed: ±30m</div>
                </div>
              )}

              <div className="flex items-center gap-3 w-full pt-2">
                <button
                  type="button"
                  onClick={handleSafeClose}
                  className="flex-1 py-2.5 px-4 rounded-xl border border-slate-700 text-xs font-semibold text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={acquireFreshGps}
                  className="flex-1 py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white transition-all shadow-lg shadow-blue-600/30"
                >
                  Retry GPS
                </button>
              </div>
            </div>
          )}

          {/* STEP 3: LIVE CAMERA VIEW */}
          {step === 'camera' && (
            <div className="space-y-4">
              {/* GPS Verified Status Pill */}
              {gps && (
                <div className="flex items-center justify-between bg-slate-800/80 border border-slate-700 px-3 py-1.5 rounded-xl text-[11px] font-mono text-slate-300">
                  <span className="flex items-center gap-1.5 text-emerald-400">
                    <span>✓ GPS Verified:</span>
                    <span>{gps.lat.toFixed(4)}, {gps.lon.toFixed(4)}</span>
                  </span>
                  <span className={accuracyBadge?.color || 'text-slate-400'}>
                    ±{Math.round(gps.accuracy)}m
                  </span>
                </div>
              )}

              {cameraError ? (
                <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs text-center space-y-3">
                  <p>{cameraError}</p>
                  <button
                    onClick={() => startCamera(facingMode)}
                    className="px-3 py-1.5 bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 rounded-lg text-xs font-semibold"
                  >
                    Retry Camera
                  </button>
                </div>
              ) : (
                <div className="relative w-full aspect-[4/3] rounded-2xl overflow-hidden bg-black border border-slate-700 shadow-inner">
                  <video
                    ref={videoRef}
                    playsInline
                    muted
                    autoPlay
                    className="w-full h-full object-cover"
                    style={{ transform: facingMode === 'user' ? 'scaleX(-1)' : 'none' }}
                  />

                  {/* Face Guide Oval Overlay */}
                  <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                    <div className="w-48 h-60 border-2 border-dashed border-emerald-400/60 rounded-[50%] shadow-[0_0_0_9999px_rgba(15,23,42,0.35)]" />
                  </div>

                  {/* Camera control buttons overlay */}
                  <div className="absolute top-2.5 right-2.5 z-10">
                    <button
                      type="button"
                      onClick={handleToggleCamera}
                      className="px-2.5 py-1 bg-slate-900/80 hover:bg-slate-900 backdrop-blur-md border border-slate-700 text-slate-200 rounded-lg text-[11px] font-semibold flex items-center gap-1 shadow-lg"
                      title="Flip Camera"
                    >
                      🔄 <span>Flip</span>
                    </button>
                  </div>

                  <div className="absolute bottom-2 inset-x-0 text-center pointer-events-none">
                    <span className="bg-slate-950/80 backdrop-blur-md px-3 py-1 rounded-full text-[10px] text-slate-300 border border-slate-700/60">
                      Center your face in the oval guide
                    </span>
                  </div>
                </div>
              )}

              {/* Snap Button */}
              <div className="pt-1 flex flex-col items-center">
                <button
                  type="button"
                  onClick={handleCapturePhoto}
                  disabled={Boolean(cameraError)}
                  className="w-full py-3 px-4 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-sm tracking-wide shadow-lg shadow-emerald-600/30 active:scale-[0.98] transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  <span className="text-lg">📸</span>
                  <span>Capture Selfie</span>
                </button>
                <p className="text-[10px] text-slate-500 mt-2 text-center">
                  * Note: Browser camera capture cannot guarantee a tamper-proof photo against physical spoofing.
                </p>
              </div>
            </div>
          )}

          {/* STEP 4: PREVIEW & CONFIRM */}
          {step === 'preview' && capturedImage && (
            <div className="space-y-4">
              <div className="relative w-full aspect-[4/3] rounded-2xl overflow-hidden bg-black border border-slate-700 shadow-inner">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={capturedImage}
                  alt="Captured Selfie Preview"
                  className="w-full h-full object-cover"
                />

                {/* Stamp overlay */}
                <div className="absolute bottom-2 inset-x-2 bg-slate-950/80 backdrop-blur-md border border-slate-800 p-2 rounded-xl text-[10px] font-mono text-slate-300 space-y-0.5">
                  <div className="flex justify-between text-white font-bold">
                    <span>{employee.name} ({employee.id})</span>
                    <span className="text-emerald-400">Verified Photo</span>
                  </div>
                  {gps && (
                    <div className="text-slate-400">
                      GPS: {gps.lat.toFixed(5)}, {gps.lon.toFixed(5)} (±{Math.round(gps.accuracy)}m)
                    </div>
                  )}
                  {capturedAt && (
                    <div className="text-slate-400">
                      Time: {new Date(capturedAt).toLocaleTimeString()}
                    </div>
                  )}
                </div>
              </div>

              {errorMessage && (
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">
                  {errorMessage}
                </div>
              )}

              <div className="flex items-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={handleRetake}
                  className="flex-1 py-3 px-4 rounded-xl border border-slate-700 bg-slate-800/80 hover:bg-slate-800 text-xs font-semibold text-slate-200 transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <span>↺</span>
                  <span>Retake</span>
                </button>

                <button
                  type="button"
                  onClick={handleConfirmAndSave}
                  className={`flex-[2] py-3 px-4 rounded-xl font-bold text-xs tracking-wide text-white transition-all shadow-lg active:scale-[0.98] cursor-pointer flex items-center justify-center gap-1.5 ${
                    type === 'start'
                      ? 'bg-emerald-600 hover:bg-emerald-500 shadow-emerald-600/30'
                      : 'bg-blue-600 hover:bg-blue-500 shadow-blue-600/30'
                  }`}
                >
                  <span>✓</span>
                  <span>{type === 'start' ? 'Confirm & Start Shift' : 'Confirm & End Shift'}</span>
                </button>
              </div>
            </div>
          )}

          {/* STEP 5: SUBMITTING / SAVING */}
          {step === 'submitting' && (
            <div className="py-12 flex flex-col items-center justify-center text-center space-y-4">
              <div className="w-12 h-12 rounded-full border-3 border-emerald-500/20 border-t-emerald-500 animate-spin" />
              <div className="space-y-1">
                <h4 className="text-sm font-semibold text-white">Saving Verified Shift...</h4>
                <p className="text-xs text-slate-400 max-w-xs">{submittingStatus}</p>
              </div>
            </div>
          )}

          {/* STEP 6: SUCCESS */}
          {step === 'success' && (
            <div className="py-10 flex flex-col items-center justify-center text-center space-y-3">
              <div className="w-14 h-14 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-2xl text-emerald-400 animate-bounce">
                ✓
              </div>
              <div className="space-y-1">
                <h4 className="text-base font-bold text-white">
                  {type === 'start' ? 'Shift Started!' : 'Shift Ended!'}
                </h4>
                <p className="text-xs text-emerald-300">
                  {type === 'start' ? 'Your attendance has been verified with selfie and GPS.' : 'Shift completed and overtime calculated successfully.'}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

