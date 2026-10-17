import React, { useState } from 'react';
import { getPhotoViewUrl } from '@/lib/api';

interface PhotoModalProps {
  isOpen: boolean;
  photoKey: string;
  token: string;
  title: string;
  employeeName?: string;
  employeeId?: string;
  timestamp?: string;
  lat?: number | null;
  lon?: number | null;
  accuracy?: number | null;
  status?: string;
  onClose: () => void;
  onPurgePhoto?: () => void;
}

export default function PhotoModal({
  isOpen,
  photoKey,
  token,
  title,
  employeeName,
  employeeId,
  timestamp,
  lat,
  lon,
  accuracy,
  status = 'Verified',
  onClose,
  onPurgePhoto,
}: PhotoModalProps) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);

  if (!isOpen) return null;

  const photoUrl = getPhotoViewUrl(photoKey, token);
  const hasGps = lat != null && lon != null && !isNaN(lat) && !isNaN(lon);
  const isLegacy = !photoKey || status === 'Legacy Record';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/85 backdrop-blur-md animate-fade-in">
      <div className="relative w-full max-w-lg bg-slate-900 border border-slate-700/80 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/60">
          <div className="flex items-center gap-2.5">
            <span className="text-xl">📸</span>
            <div>
              <h3 className="text-sm font-bold text-white tracking-wide">{title}</h3>
              <p className="text-[11px] text-slate-400">
                {employeeName ? `${employeeName} (${employeeId || ''})` : employeeId || ''}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="p-5 overflow-y-auto space-y-4">
          {/* Photo Display */}
          <div className="relative w-full aspect-[4/3] rounded-2xl overflow-hidden bg-black border border-slate-800 flex items-center justify-center">
            {isLegacy ? (
              <div className="text-center p-6 space-y-2">
                <span className="text-4xl text-amber-400 block">📜</span>
                <p className="text-sm font-semibold text-amber-300">Historical Legacy Record</p>
                <p className="text-xs text-slate-400 max-w-xs">
                  This shift was recorded prior to mandatory photo verification. No selfie photo was required.
                </p>
              </div>
            ) : imageError ? (
              <div className="text-center p-6 space-y-2">
                <span className="text-3xl text-rose-400 block">⚠️</span>
                <p className="text-xs text-rose-300 font-semibold">Photo Unavailable</p>
                <p className="text-[11px] text-slate-500">
                  Could not load photo from storage. Key: <span className="font-mono">{photoKey}</span>
                </p>
              </div>
            ) : (
              <>
                {!imageLoaded && (
                  <div className="absolute inset-0 flex items-center justify-center bg-slate-950">
                    <div className="w-8 h-8 rounded-full border-2 border-emerald-500/20 border-t-emerald-500 animate-spin" />
                  </div>
                )}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photoUrl}
                  alt={title}
                  onLoad={() => setImageLoaded(true)}
                  onError={() => setImageError(true)}
                  className={`w-full h-full object-cover transition-opacity duration-300 ${
                    imageLoaded ? 'opacity-100' : 'opacity-0'
                  }`}
                />
              </>
            )}
          </div>

          {/* Verification Details */}
          <div className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-4 space-y-2.5 text-xs">
            <div className="flex items-center justify-between pb-2 border-b border-slate-700/60">
              <span className="text-slate-400">Verification Status</span>
              <span
                className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                  isLegacy
                    ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                    : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                }`}
              >
                {isLegacy ? 'Legacy Record' : 'Verified Selfie'}
              </span>
            </div>

            {timestamp && (
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Captured At (UAE Time)</span>
                <span className="font-mono text-white font-medium">
                  {new Date(timestamp).toLocaleString('en-GB', {
                    timeZone: 'Asia/Dubai',
                    dateStyle: 'medium',
                    timeStyle: 'medium',
                  })}
                </span>
              </div>
            )}

            {hasGps && (
              <div className="flex items-center justify-between">
                <span className="text-slate-400">GPS Location</span>
                <a
                  href={`https://www.google.com/maps?q=${lat},${lon}`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-emerald-400 hover:text-emerald-300 hover:underline flex items-center gap-1 font-medium"
                >
                  <span>📍</span>
                  <span>{lat?.toFixed(5)}, {lon?.toFixed(5)}</span>
                  {accuracy != null && <span className="text-[10px] text-slate-400">(±{Math.round(accuracy)}m)</span>}
                  <span className="text-[9px]">↗</span>
                </a>
              </div>
            )}

            {photoKey && !isLegacy && (
              <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1 border-t border-slate-700/40">
                <span>Storage Key</span>
                <span className="font-mono text-[10px] text-slate-300 truncate max-w-[220px]" title={photoKey}>
                  {photoKey}
                </span>
              </div>
            )}
          </div>

          <p className="text-[10px] text-slate-500 text-center">
            * Security note: Browser-based camera capture cannot guarantee a tamper-proof photo against physical spoofing.
          </p>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-800 bg-slate-900/60 flex items-center justify-between">
          <div>
            {photoKey && !isLegacy && onPurgePhoto && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onPurgePhoto();
                }}
                className="px-3 py-1.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1.5"
              >
                <span>🗑️</span>
                <span>Purge Photo (Retention Policy)</span>
              </button>
            )}
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

