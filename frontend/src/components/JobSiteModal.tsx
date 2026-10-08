import React, { useState, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import { JobSite, createJobSite, updateJobSite } from '@/lib/api';
import { parseGoogleMapsUrlOrCoords, searchNominatim, GeocodingSearchResult } from '@/lib/locationParser';

// Dynamically import Leaflet LocationPickerMap to prevent SSR "window is not defined" errors
const LocationPickerMap = dynamic(() => import('@/components/LocationPickerMap'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-[320px] rounded-2xl bg-slate-900 border border-slate-800 flex flex-col items-center justify-center text-slate-500 space-y-2">
      <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      <span className="text-xs">Loading OpenStreetMap interactive picker...</span>
    </div>
  ),
});

interface JobSiteModalProps {
  token: string;
  siteToEdit?: JobSite | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}

export default function JobSiteModal({
  token,
  siteToEdit,
  onClose,
  onSaved,
}: JobSiteModalProps) {
  const isEditing = Boolean(siteToEdit);

  // Form Fields
  const [siteName, setSiteName] = useState(siteToEdit?.Name || '');
  const [siteAddress, setSiteAddress] = useState(siteToEdit?.Address || '');
  const [lat, setLat] = useState<number>(siteToEdit ? siteToEdit.Latitude : 25.2048); // Default Dubai
  const [lon, setLon] = useState<number>(siteToEdit ? siteToEdit.Longitude : 55.2708);
  const [radiusPreset, setRadiusPreset] = useState<'50' | '100' | '200' | 'custom'>(() => {
    if (!siteToEdit) return '100';
    const r = siteToEdit['Geofence Radius'];
    if (r === 50) return '50';
    if (r === 100) return '100';
    if (r === 200) return '200';
    return 'custom';
  });
  const [customRadius, setCustomRadius] = useState<string>(
    siteToEdit ? String(siteToEdit['Geofence Radius']) : '100'
  );

  // Location Selector / Link Input
  const [locationInput, setLocationInput] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<GeocodingSearchResult[]>([]);
  const [linkNotice, setLinkNotice] = useState<{ type: 'success' | 'warning' | 'error'; message: string; rawUrl?: string } | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const searchAbortRef = useRef<AbortController | null>(null);

  // Effective radius in meters
  const effectiveRadius =
    radiusPreset === 'custom'
      ? Math.max(10, parseInt(customRadius, 10) || 100)
      : parseInt(radiusPreset, 10);

  // Handle location input change: auto-detect Google Maps link or coordinates
  const handleLocationInputChange = (val: string) => {
    setLocationInput(val);
    setLinkNotice(null);
    setSearchResults([]);

    const trimmed = val.trim();
    if (!trimmed) return;

    // Check if it is a Google Maps link or raw coordinates
    if (
      trimmed.includes('google.com/maps') ||
      trimmed.includes('maps.app.goo.gl') ||
      trimmed.includes('goo.gl/maps') ||
      /^[+-]?\d+(?:\.\d+)?\s*,\s*[+-]?\d+(?:\.\d+)?$/.test(trimmed)
    ) {
      const parsed = parseGoogleMapsUrlOrCoords(trimmed);
      if (parsed.success && parsed.lat !== undefined && parsed.lon !== undefined) {
        setLat(parsed.lat);
        setLon(parsed.lon);
        if (parsed.name && !siteName) {
          setSiteName(parsed.name);
        }
        setLinkNotice({
          type: 'success',
          message: `Location detected from Google Maps (${parsed.lat.toFixed(5)}, ${parsed.lon.toFixed(5)})! Position marked on map.`,
        });
      } else if (parsed.isShortLink) {
        setLinkNotice({
          type: 'warning',
          message: parsed.error || 'Shortened link detected.',
          rawUrl: parsed.rawUrl,
        });
      } else if (parsed.error) {
        setLinkNotice({
          type: 'error',
          message: parsed.error,
        });
      }
    }
  };

  // Perform free Nominatim geocoding search on button click or Enter key
  const handlePerformSearch = async () => {
    const query = locationInput.trim();
    if (!query) return;

    // First check if it was a link
    if (
      query.includes('google.com/maps') ||
      query.includes('maps.app.goo.gl') ||
      query.includes('goo.gl/maps') ||
      /^[+-]?\d+(?:\.\d+)?\s*,\s*[+-]?\d+(?:\.\d+)?$/.test(query)
    ) {
      handleLocationInputChange(query);
      return;
    }

    if (searchAbortRef.current) {
      searchAbortRef.current.abort();
    }
    const controller = new AbortController();
    searchAbortRef.current = controller;

    setIsSearching(true);
    setLinkNotice(null);
    try {
      const results = await searchNominatim(query, controller.signal);
      setSearchResults(results);
      if (results.length === 0) {
        setLinkNotice({
          type: 'warning',
          message: `No matching locations found for "${query}". Try adding the city or country (e.g. "${query}, Dubai").`,
        });
      }
    } catch {
      // Aborted or network issue
    } finally {
      setIsSearching(false);
    }
  };

  const handleSelectSearchResult = (result: GeocodingSearchResult) => {
    setLat(result.lat);
    setLon(result.lon);
    if (!siteName) {
      setSiteName(result.name);
    }
    if (!siteAddress) {
      setSiteAddress(result.displayName);
    }
    setSearchResults([]);
    setLocationInput(result.displayName);
    setLinkNotice({
      type: 'success',
      message: `Selected "${result.name}" (${result.lat.toFixed(5)}, ${result.lon.toFixed(5)})!`,
    });
  };

  // Submit Handler
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const name = siteName.trim();
    if (!name) {
      setFormError('Please provide a Job Site Name.');
      return;
    }

    if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      setFormError('Please select a valid location on the map.');
      return;
    }

    if (isNaN(effectiveRadius) || effectiveRadius < 10 || effectiveRadius > 5000) {
      setFormError('Geofence radius must be between 10m and 5000m.');
      return;
    }

    setSubmitting(true);
    try {
      if (isEditing && siteToEdit) {
        const res = await updateJobSite(token, {
          siteId: siteToEdit.ID,
          name,
          address: siteAddress.trim(),
          latitude: lat,
          longitude: lon,
          geofenceRadius: effectiveRadius,
          status: siteToEdit.Status,
        });
        if (res.success) {
          onSaved(`Job Site "${name}" (${siteToEdit.ID}) updated successfully in Google Sheets!`);
        } else {
          setFormError(res.message || 'Failed to update job site.');
        }
      } else {
        const res = await createJobSite(token, {
          name,
          address: siteAddress.trim(),
          latitude: lat,
          longitude: lon,
          geofenceRadius: effectiveRadius,
        });
        if (res.success) {
          onSaved(`Job Site "${name}" created successfully in Google Sheets!`);
        } else {
          setFormError(res.message || 'Failed to create job site.');
        }
      }
    } catch (err: unknown) {
      setFormError((err as Error).message || 'Network error occurred while saving.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div className="glass-panel bg-slate-900 border border-slate-700/80 rounded-3xl p-5 sm:p-7 max-w-xl w-full shadow-2xl my-auto space-y-5">
        {/* Header */}
        <div className="flex justify-between items-start">
          <div>
            <h3 className="text-lg sm:text-xl font-bold text-white flex items-center gap-2">
              <span>{isEditing ? '✏️' : '🏗️'}</span>
              <span>{isEditing ? 'Edit Job Site' : 'Create New Job Site'}</span>
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              {isEditing
                ? `Updating site ${siteToEdit?.ID} and geofence coordinates in Google Sheets.`
                : 'Paste a Google Maps link, search an address, or position the pin on the map.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 text-lg rounded-xl hover:bg-slate-800 transition-all cursor-pointer"
          >
            ✕
          </button>
        </div>

        {formError && (
          <div className="p-3 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">
            ⚠️ {formError}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* 1. Site Name */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
              Job Site Name <span className="text-rose-400">*</span>
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Dubai Marina Tower Phase 2"
              value={siteName}
              onChange={(e) => setSiteName(e.target.value)}
              className="w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
            />
          </div>

          {/* 2. Location Search / Google Maps Link */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
              Location Search or Google Maps Link
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Search address or paste Google Maps URL..."
                value={locationInput}
                onChange={(e) => handleLocationInputChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handlePerformSearch();
                  }
                }}
                className="flex-1 px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all placeholder:text-slate-500"
              />
              <button
                type="button"
                onClick={handlePerformSearch}
                disabled={isSearching || !locationInput.trim()}
                className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-md shadow-blue-600/30 transition-all cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
              >
                <span>{isSearching ? '⌛' : '🔍'}</span>
                <span className="hidden sm:inline">{isSearching ? 'Searching...' : 'Search'}</span>
              </button>
            </div>

            {/* Link / Geocoding Notice Banner */}
            {linkNotice && (
              <div
                className={`mt-2 p-2.5 rounded-xl text-xs flex items-start gap-2 border ${
                  linkNotice.type === 'success'
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                    : linkNotice.type === 'warning'
                    ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                    : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                }`}
              >
                <span className="text-sm">
                  {linkNotice.type === 'success' ? '✓' : linkNotice.type === 'warning' ? 'ℹ️' : '⚠️'}
                </span>
                <div className="flex-1 leading-relaxed">
                  <p>{linkNotice.message}</p>
                  {linkNotice.rawUrl && (
                    <div className="mt-1.5 flex items-center gap-2">
                      <a
                        href={linkNotice.rawUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="px-2.5 py-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 rounded-lg text-[11px] font-semibold border border-amber-500/40 inline-flex items-center gap-1"
                      >
                        <span>Open Link in Google Maps</span>
                        <span>↗</span>
                      </a>
                      <span className="text-[10px] text-amber-400/80">
                        (Copy full address or URL from browser)
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Nominatim Search Results Dropdown */}
            {searchResults.length > 0 && (
              <div className="mt-2 rounded-2xl bg-slate-800 border border-slate-700 divide-y divide-slate-700/60 overflow-hidden shadow-xl max-h-48 overflow-y-auto">
                {searchResults.map((res, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => handleSelectSearchResult(res)}
                    className="w-full text-left p-2.5 hover:bg-slate-700/60 transition-all text-xs flex items-start gap-2 cursor-pointer"
                  >
                    <span className="text-blue-400 mt-0.5">📍</span>
                    <div className="flex-1 truncate">
                      <p className="font-semibold text-white truncate">{res.name}</p>
                      <p className="text-[11px] text-slate-400 truncate">{res.displayName}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 3. Interactive Leaflet Map with Draggable Pin */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
              Interactive Geofence Map
            </label>
            <LocationPickerMap
              lat={lat}
              lon={lon}
              radius={effectiveRadius}
              onLocationChange={(newLat, newLon) => {
                setLat(newLat);
                setLon(newLon);
                setLinkNotice(null);
              }}
              height="280px"
            />
          </div>

          {/* 4. Geofence Radius Selector */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
              Geofence Radius
            </label>
            <div className="grid grid-cols-4 gap-2">
              {[
                { id: '50', label: '50m', sub: 'Compact' },
                { id: '100', label: '100m', sub: 'Standard' },
                { id: '200', label: '200m', sub: 'Large' },
                { id: 'custom', label: 'Custom', sub: 'Manual' },
              ].map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => setRadiusPreset(preset.id as typeof radiusPreset)}
                  className={`py-2 px-2 rounded-xl text-xs font-semibold transition-all border text-center cursor-pointer ${
                    radiusPreset === preset.id
                      ? 'bg-blue-600 text-white border-blue-500 shadow-md shadow-blue-600/30'
                      : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                  }`}
                >
                  <div>{preset.label}</div>
                  <div className="text-[10px] opacity-75 font-normal">{preset.sub}</div>
                </button>
              ))}
            </div>

            {radiusPreset === 'custom' && (
              <div className="mt-2.5 flex items-center gap-2">
                <input
                  type="number"
                  min="10"
                  max="2000"
                  step="5"
                  value={customRadius}
                  onChange={(e) => setCustomRadius(e.target.value)}
                  placeholder="Enter radius in meters (e.g. 150)"
                  className="flex-1 px-4 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <span className="text-xs text-slate-400 font-mono">meters</span>
              </div>
            )}
          </div>

          {/* 5. Address / Location Notes (Optional) */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
              Address / Notes <span className="text-slate-500 font-normal">(Optional)</span>
            </label>
            <input
              type="text"
              placeholder="e.g. Near Gate 3, Downtown Dubai"
              value={siteAddress}
              onChange={(e) => setSiteAddress(e.target.value)}
              className="w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all placeholder:text-slate-500"
            />
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3 pt-3">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="flex-1 py-2.5 rounded-xl text-xs font-semibold text-slate-300 bg-slate-800 hover:bg-slate-700 border border-slate-700 transition-all cursor-pointer disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !siteName.trim()}
              className="flex-1 py-2.5 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 shadow-lg shadow-blue-600/30 transition-all disabled:opacity-50 cursor-pointer flex items-center justify-center gap-1.5"
            >
              {submitting ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Saving to Google Sheets...</span>
                </>
              ) : (
                <span>{isEditing ? 'Save Changes' : 'Create Job Site'}</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
